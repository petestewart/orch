/**
 * Plan Audit Tests
 *
 * Tests for the plan audit functionality (T038)
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import {
  runPlanAudit,
  comparePlanToPRD,
  extractPRDRequirements,
  checkDependencies,
  checkStaleness,
  analyzeCodebaseCoverage,
  checkOrphanedTickets,
} from './plan-audit';
import type { Ticket, Epic } from './types';
import type { ParsedPlan } from './plan-store';
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Helper to create mock plan
function createMockPlan(tickets: Partial<Ticket>[] = [], epics: Epic[] = []): ParsedPlan {
  const fullTickets: Ticket[] = tickets.map((t, i) => ({
    id: t.id || `T${String(i + 1).padStart(3, '0')}`,
    title: t.title || `Test Ticket ${i + 1}`,
    priority: t.priority || 'P1',
    status: t.status || 'Todo',
    owner: t.owner,
    dependencies: t.dependencies || [],
    acceptanceCriteria: t.acceptanceCriteria || [],
    validationSteps: t.validationSteps || [],
    description: t.description,
    notes: t.notes,
    epic: t.epic,
  }));

  return {
    overview: 'Test plan overview',
    definitionOfDone: ['Tests pass'],
    epics,
    tickets: fullTickets,
    rawContent: '# Test Plan',
  };
}

describe('extractPRDRequirements', () => {
  test('extracts requirements from markdown table', () => {
    const prdContent = `
# Product Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| R1 | System shall authenticate users | P0 |
| R2 | System shall log all actions | P1 |
`;

    const requirements = extractPRDRequirements(prdContent);
    expect(requirements.length).toBe(2);
    expect(requirements[0]).toEqual({
      id: 'R1',
      text: 'System shall authenticate users',
      priority: 'P0',
    });
    expect(requirements[1]).toEqual({
      id: 'R2',
      text: 'System shall log all actions',
      priority: 'P1',
    });
  });

  test('extracts numbered requirements', () => {
    const prdContent = `
# Requirements

1. Users must be able to login
2. Users must be able to logout
`;

    const requirements = extractPRDRequirements(prdContent);
    expect(requirements.length).toBe(2);
    expect(requirements[0].text).toBe('Users must be able to login');
    expect(requirements[1].text).toBe('Users must be able to logout');
  });

  test('extracts bullet point requirements with keywords', () => {
    const prdContent = `
# Functional Requirements

- System shall store user preferences
- System must validate input
- System should log errors
`;

    const requirements = extractPRDRequirements(prdContent);
    expect(requirements.some(r => r.text.includes('store user preferences'))).toBe(true);
    expect(requirements.some(r => r.text.includes('validate input'))).toBe(true);
    expect(requirements.some(r => r.text.includes('log errors'))).toBe(true);
  });

  test('deduplicates similar requirements', () => {
    const prdContent = `
| ID | Requirement | Priority |
|----|-------------|----------|
| R1 | User authentication | P0 |
| R1 | User Authentication | P0 |
`;

    const requirements = extractPRDRequirements(prdContent);
    // Should deduplicate case-insensitive
    expect(requirements.length).toBe(1);
  });
});

describe('comparePlanToPRD', () => {
  test('finds uncovered requirements', () => {
    const plan = createMockPlan([
      { title: 'Implement login', acceptanceCriteria: ['Users can login'] },
    ]);

    const prdContent = `
| ID | Requirement | Priority |
|----|-------------|----------|
| R1 | User can login | P0 |
| R2 | User can reset password | P1 |
`;

    const findings = comparePlanToPRD(plan, prdContent);

    // R2 (password reset) should not be covered
    expect(findings.some(f =>
      f.message.includes('password') || f.message.includes('reset')
    )).toBe(true);
  });

  test('does not flag covered requirements', () => {
    const plan = createMockPlan([
      {
        title: 'User authentication',
        acceptanceCriteria: ['Users can login to the system'],
      },
    ]);

    const prdContent = `
| ID | Requirement | Priority |
|----|-------------|----------|
| R1 | User can login | P0 |
`;

    const findings = comparePlanToPRD(plan, prdContent);

    // Should not flag login as uncovered since there's a matching ticket
    expect(findings.filter(f => f.message.toLowerCase().includes('login')).length).toBe(0);
  });
});

describe('checkDependencies', () => {
  test('detects invalid dependencies', () => {
    const plan = createMockPlan([
      { id: 'T001', title: 'First', dependencies: ['T999'] }, // T999 doesn't exist
    ]);

    const findings = checkDependencies(plan);

    expect(findings.some(f =>
      f.severity === 'error' &&
      f.message.includes('non-existent') &&
      f.message.includes('T999')
    )).toBe(true);
  });

  test('detects circular dependencies', () => {
    const plan = createMockPlan([
      { id: 'T001', title: 'First', dependencies: ['T002'] },
      { id: 'T002', title: 'Second', dependencies: ['T001'] },
    ]);

    const findings = checkDependencies(plan);

    expect(findings.some(f =>
      f.severity === 'error' &&
      f.message.includes('circular')
    )).toBe(true);
  });

  test('detects ready tickets still in Todo', () => {
    const plan = createMockPlan([
      { id: 'T001', title: 'First', status: 'Done', dependencies: [] },
      { id: 'T002', title: 'Second', status: 'Todo', dependencies: ['T001'] },
    ]);

    const findings = checkDependencies(plan);

    expect(findings.some(f =>
      f.severity === 'info' &&
      f.message.includes('T002') &&
      f.message.includes('dependencies completed')
    )).toBe(true);
  });

  test('does not flag valid dependencies', () => {
    const plan = createMockPlan([
      { id: 'T001', title: 'First', status: 'Todo', dependencies: [] },
      { id: 'T002', title: 'Second', status: 'Todo', dependencies: ['T001'] },
    ]);

    const findings = checkDependencies(plan);

    // Should not have any errors (only info about T002 being ready when T001 is done)
    expect(findings.filter(f => f.severity === 'error').length).toBe(0);
  });
});

describe('checkStaleness', () => {
  test('detects in-progress tickets without owner', () => {
    const plan = createMockPlan([
      { id: 'T001', title: 'First', status: 'InProgress', owner: undefined },
    ]);

    const findings = checkStaleness(plan);

    expect(findings.some(f =>
      f.severity === 'warning' &&
      f.message.includes('T001') &&
      f.message.includes('no owner')
    )).toBe(true);
  });

  test('detects tickets without acceptance criteria', () => {
    const plan = createMockPlan([
      { id: 'T001', title: 'First', status: 'Todo', acceptanceCriteria: [] },
    ]);

    const findings = checkStaleness(plan);

    expect(findings.some(f =>
      f.severity === 'warning' &&
      f.message.includes('T001') &&
      f.message.includes('no acceptance criteria')
    )).toBe(true);
  });

  test('detects tickets without validation steps', () => {
    const plan = createMockPlan([
      { id: 'T001', title: 'First', status: 'Todo', validationSteps: [] },
    ]);

    const findings = checkStaleness(plan);

    expect(findings.some(f =>
      f.severity === 'info' &&
      f.message.includes('T001') &&
      f.message.includes('no validation steps')
    )).toBe(true);
  });

  test('does not flag Done tickets', () => {
    const plan = createMockPlan([
      {
        id: 'T001',
        title: 'First',
        status: 'Done',
        acceptanceCriteria: [],
        validationSteps: [],
      },
    ]);

    const findings = checkStaleness(plan);

    // Done tickets should not be flagged for missing AC or validation steps
    expect(findings.filter(f => f.ticketId === 'T001').length).toBe(0);
  });
});

describe('analyzeCodebaseCoverage', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'orch-audit-test-'));
    mkdirSync(join(tempDir, 'src'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('detects TODO comments', async () => {
    writeFileSync(join(tempDir, 'src', 'test.ts'), `
// TODO: implement this feature
function placeholder() {}
`);

    const plan = createMockPlan([]);
    const findings = await analyzeCodebaseCoverage(tempDir, plan);

    expect(findings.some(f =>
      f.category === 'coverage' &&
      f.message.includes('TODO')
    )).toBe(true);
  });

  test('detects FIXME comments', async () => {
    writeFileSync(join(tempDir, 'src', 'test.ts'), `
// FIXME: this is broken
function broken() {}
`);

    const plan = createMockPlan([]);
    const findings = await analyzeCodebaseCoverage(tempDir, plan);

    expect(findings.some(f =>
      f.message.includes('FIXME')
    )).toBe(true);
  });

  test('limits findings count', async () => {
    // Create many files with TODOs
    for (let i = 0; i < 30; i++) {
      writeFileSync(join(tempDir, 'src', `test${i}.ts`), `
// TODO: fix this ${i}
`);
    }

    const plan = createMockPlan([]);
    const findings = await analyzeCodebaseCoverage(tempDir, plan);

    // Should be limited to ~20 + 1 truncation message
    expect(findings.length).toBeLessThanOrEqual(22);
  });
});

describe('checkOrphanedTickets', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'orch-audit-test-'));
    mkdirSync(join(tempDir, 'src'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('detects references to non-existent files', async () => {
    // Note: ticket references src/missing.ts which doesn't exist
    const plan = createMockPlan([
      {
        id: 'T001',
        title: 'Update src/missing.ts',
        description: 'Fix bug in src/missing.ts',
        status: 'Todo',
      },
    ]);

    // Create a different file
    writeFileSync(join(tempDir, 'src', 'existing.ts'), 'export const x = 1;');

    const findings = await checkOrphanedTickets(tempDir, plan);

    expect(findings.some(f =>
      f.category === 'orphaned' &&
      f.message.includes('missing.ts')
    )).toBe(true);
  });

  test('does not flag existing files', async () => {
    const plan = createMockPlan([
      {
        id: 'T001',
        title: 'Update src/existing.ts',
        description: 'Fix bug in src/existing.ts',
        status: 'Todo',
      },
    ]);

    // Create the referenced file
    writeFileSync(join(tempDir, 'src', 'existing.ts'), 'export const x = 1;');

    const findings = await checkOrphanedTickets(tempDir, plan);

    // Should not flag existing.ts as orphaned
    expect(findings.filter(f =>
      f.message.includes('existing.ts')
    ).length).toBe(0);
  });

  test('does not flag files in create tickets', async () => {
    const plan = createMockPlan([
      {
        id: 'T001',
        title: 'Create src/newfile.ts',
        description: 'Implement new feature in src/newfile.ts',
        status: 'Todo',
      },
    ]);

    const findings = await checkOrphanedTickets(tempDir, plan);

    // Should not flag newfile.ts since the ticket is about creating it
    expect(findings.filter(f =>
      f.message.includes('newfile.ts')
    ).length).toBe(0);
  });

  test('skips Done tickets', async () => {
    const plan = createMockPlan([
      {
        id: 'T001',
        title: 'Fix src/deleted.ts',
        status: 'Done',
      },
    ]);

    const findings = await checkOrphanedTickets(tempDir, plan);

    // Done tickets should be skipped
    expect(findings.filter(f =>
      f.ticketId === 'T001'
    ).length).toBe(0);
  });
});

describe('runPlanAudit', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'orch-audit-test-'));
    mkdirSync(join(tempDir, 'src'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('runs full audit and returns result', async () => {
    const plan = createMockPlan([
      { id: 'T001', title: 'First ticket', status: 'Todo' },
    ]);

    const result = await runPlanAudit({
      projectPath: tempDir,
      plan,
    });

    expect(result.findings).toBeDefined();
    expect(result.summary).toBeDefined();
    expect(result.summary.errors).toBeGreaterThanOrEqual(0);
    expect(result.summary.warnings).toBeGreaterThanOrEqual(0);
    expect(result.summary.infos).toBeGreaterThanOrEqual(0);
    expect(result.auditedAt).toBeInstanceOf(Date);
  });

  test('reports progress via callback', async () => {
    const plan = createMockPlan([]);
    const phases: string[] = [];

    await runPlanAudit({
      projectPath: tempDir,
      plan,
      onProgress: (phase, progress) => {
        phases.push(phase);
      },
    });

    expect(phases).toContain('loading');
    expect(phases).toContain('prd-comparison');
    expect(phases).toContain('codebase-analysis');
    expect(phases).toContain('dependency-check');
    expect(phases).toContain('complete');
  });

  test('includes PRD findings when PRD.md exists', async () => {
    writeFileSync(join(tempDir, 'PRD.md'), `
# Product Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| R1 | Feature A | P0 |
`);

    const plan = createMockPlan([]); // No tickets covering Feature A

    const result = await runPlanAudit({
      projectPath: tempDir,
      plan,
    });

    // Should have at least one finding about uncovered requirement
    expect(result.findings.some(f =>
      f.category === 'coverage' &&
      f.message.includes('Feature A')
    )).toBe(true);
  });

  test('skips PRD comparison when PRD.md does not exist', async () => {
    const plan = createMockPlan([
      { id: 'T001', title: 'First ticket' },
    ]);

    const result = await runPlanAudit({
      projectPath: tempDir,
      plan,
    });

    // Should not fail if PRD.md doesn't exist
    expect(result.findings).toBeDefined();
    expect(result.summary).toBeDefined();
  });
});
