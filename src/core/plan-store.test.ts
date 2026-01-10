/**
 * Plan Store Tests
 *
 * Tests for T002: Plan Parser - Read PLAN.md
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { PlanStore, parseTicket, validatePlan, type ParsedPlan, type ParseError } from './plan-store';
import { resetEventBus, getEventBus } from './events';
import type { Ticket } from './types';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('parseTicket', () => {
  test('parses a complete ticket with all fields', () => {
    const markdown = `### Ticket: T001 Event Bus Implementation
- **Priority:** P0
- **Status:** Done
- **Owner:** Completed
- **Scope:** Create the central event bus that all components will use for communication.
- **Acceptance Criteria:**
  - EventBus class with typed events
  - Subscribe returns unsubscribe function
  - Publish is synchronous
- **Validation Steps:**
  - \`bun run typecheck\` passes
  - Unit test works
- **Notes:** Some notes here
- **Dependencies:** T002, T003`;

    const result = parseTicket(markdown);

    expect('line' in result).toBe(false); // Not an error
    const ticket = result as Ticket;
    expect(ticket.id).toBe('T001');
    expect(ticket.title).toBe('Event Bus Implementation');
    expect(ticket.priority).toBe('P0');
    expect(ticket.status).toBe('Done');
    expect(ticket.owner).toBe('Completed');
    expect(ticket.description).toBe('Create the central event bus that all components will use for communication.');
    expect(ticket.acceptanceCriteria).toHaveLength(3);
    expect(ticket.acceptanceCriteria[0]).toBe('EventBus class with typed events');
    expect(ticket.validationSteps).toHaveLength(2);
    expect(ticket.validationSteps[0]).toBe('`bun run typecheck` passes');
    expect(ticket.notes).toBe('Some notes here');
    expect(ticket.dependencies).toEqual(['T002', 'T003']);
  });

  test('parses a ticket with minimal required fields', () => {
    const markdown = `### Ticket: T042 Simple Task
- **Priority:** P1
- **Status:** Todo`;

    const result = parseTicket(markdown);

    expect('line' in result).toBe(false);
    const ticket = result as Ticket;
    expect(ticket.id).toBe('T042');
    expect(ticket.title).toBe('Simple Task');
    expect(ticket.priority).toBe('P1');
    expect(ticket.status).toBe('Todo');
    expect(ticket.owner).toBeUndefined();
    expect(ticket.description).toBeUndefined();
    expect(ticket.acceptanceCriteria).toEqual([]);
    expect(ticket.validationSteps).toEqual([]);
    expect(ticket.notes).toBeUndefined();
    expect(ticket.dependencies).toEqual([]);
  });

  test('handles Unassigned owner as undefined', () => {
    const markdown = `### Ticket: T001 Test
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned`;

    const result = parseTicket(markdown);
    const ticket = result as Ticket;
    expect(ticket.owner).toBeUndefined();
  });

  test('parses all valid priority values', () => {
    const priorities = ['P0', 'P1', 'P2'] as const;

    for (const priority of priorities) {
      const markdown = `### Ticket: T001 Test
- **Priority:** ${priority}
- **Status:** Todo`;

      const result = parseTicket(markdown);
      expect('line' in result).toBe(false);
      expect((result as Ticket).priority).toBe(priority);
    }
  });

  test('parses all valid status values', () => {
    const statuses = ['Todo', 'InProgress', 'Review', 'QA', 'Done', 'Failed'] as const;

    for (const status of statuses) {
      const markdown = `### Ticket: T001 Test
- **Priority:** P0
- **Status:** ${status}`;

      const result = parseTicket(markdown);
      expect('line' in result).toBe(false);
      expect((result as Ticket).status).toBe(status);
    }
  });

  test('normalizes "In Progress" status to "InProgress"', () => {
    const markdown = `### Ticket: T001 Test
- **Priority:** P0
- **Status:** In Progress`;

    const result = parseTicket(markdown);
    expect('line' in result).toBe(false);
    const ticket = result as Ticket;
    expect(ticket.status).toBe('InProgress');
  });

  test('returns error for invalid priority', () => {
    const markdown = `### Ticket: T001 Test
- **Priority:** P5
- **Status:** Todo`;

    const result = parseTicket(markdown, 10);

    expect('line' in result).toBe(true);
    const error = result as ParseError;
    expect(error.line).toBe(10);
    expect(error.message).toContain('Invalid priority');
    expect(error.message).toContain('P5');
  });

  test('returns error for invalid status', () => {
    const markdown = `### Ticket: T001 Test
- **Priority:** P0
- **Status:** Pending`;

    const result = parseTicket(markdown, 20);

    expect('line' in result).toBe(true);
    const error = result as ParseError;
    expect(error.line).toBe(20);
    expect(error.message).toContain('Invalid status');
    expect(error.message).toContain('Pending');
  });

  test('returns error for missing priority', () => {
    const markdown = `### Ticket: T001 Test
- **Status:** Todo`;

    const result = parseTicket(markdown);

    expect('line' in result).toBe(true);
    const error = result as ParseError;
    expect(error.message).toContain("Missing required field 'Priority'");
  });

  test('returns error for missing status', () => {
    const markdown = `### Ticket: T001 Test
- **Priority:** P0`;

    const result = parseTicket(markdown);

    expect('line' in result).toBe(true);
    const error = result as ParseError;
    expect(error.message).toContain("Missing required field 'Status'");
  });

  test('returns error for invalid header format', () => {
    const markdown = `## Ticket T001 Missing Colon
- **Priority:** P0
- **Status:** Todo`;

    const result = parseTicket(markdown);

    expect('line' in result).toBe(true);
    const error = result as ParseError;
    expect(error.message).toContain('Invalid ticket header format');
  });

  test('parses dependencies with various formats', () => {
    const markdown = `### Ticket: T005 With Deps
- **Priority:** P0
- **Status:** Todo
- **Dependencies:** T001, T002,T003,  T004`;

    const result = parseTicket(markdown);
    const ticket = result as Ticket;
    expect(ticket.dependencies).toEqual(['T001', 'T002', 'T003', 'T004']);
  });

  test('ignores invalid dependency IDs', () => {
    const markdown = `### Ticket: T005 With Deps
- **Priority:** P0
- **Status:** Todo
- **Dependencies:** T001, invalid, T002, also-invalid`;

    const result = parseTicket(markdown);
    const ticket = result as Ticket;
    expect(ticket.dependencies).toEqual(['T001', 'T002']);
  });

  test('handles multi-line notes field', () => {
    const markdown = `### Ticket: T001 Test
- **Priority:** P0
- **Status:** Todo
- **Notes:**
  - Orchestrator notes:
  - Intended approach: Use regex
  - Key constraints: Must be fast`;

    const result = parseTicket(markdown);
    const ticket = result as Ticket;
    expect(ticket.notes).toContain('Orchestrator notes:');
    expect(ticket.notes).toContain('Intended approach: Use regex');
  });
});

describe('PlanStore', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'plan-store-test-'));
    resetEventBus();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  test('loads and parses a valid PLAN.md', async () => {
    const planContent = `# Test Plan

## 1. Overview

This is a test project.

## 2. Non-Goals

N/A

## 6. Definition of Done

- [ ] All tests pass
- [x] Code reviewed

## 7. Task Backlog

### Ticket: T001 First Task
- **Priority:** P0
- **Status:** Done
- **Owner:** Completed
- **Scope:** First task description
- **Acceptance Criteria:**
  - Criterion 1
  - Criterion 2
- **Validation Steps:**
  - Step 1

### Ticket: T002 Second Task
- **Priority:** P1
- **Status:** Todo
- **Owner:** Unassigned
- **Scope:** Second task description
- **Dependencies:** T001
`;

    const planPath = join(tempDir, 'PLAN.md');
    await writeFile(planPath, planContent);

    const store = new PlanStore(planPath);
    const plan = await store.load();

    expect(plan.tickets).toHaveLength(2);
    expect(plan.tickets[0].id).toBe('T001');
    expect(plan.tickets[0].status).toBe('Done');
    expect(plan.tickets[1].id).toBe('T002');
    expect(plan.tickets[1].dependencies).toEqual(['T001']);

    expect(plan.overview).toContain('test project');
    expect(plan.definitionOfDone).toEqual(['All tests pass', 'Code reviewed']);
  });

  test('emits plan:loaded event on success', async () => {
    const planContent = `# Test Plan

## 7. Task Backlog

### Ticket: T001 Task
- **Priority:** P0
- **Status:** Todo
`;

    const planPath = join(tempDir, 'PLAN.md');
    await writeFile(planPath, planContent);

    const events: unknown[] = [];
    const bus = getEventBus();
    bus.subscribe('plan:loaded', (event) => events.push(event));

    const store = new PlanStore(planPath);
    await store.load();

    expect(events).toHaveLength(1);
    expect((events[0] as { type: string }).type).toBe('plan:loaded');
  });

  test('throws error for non-existent file', async () => {
    const planPath = join(tempDir, 'NONEXISTENT.md');
    const store = new PlanStore(planPath);

    await expect(store.load()).rejects.toThrow('Plan file not found');
  });

  test('emits plan:error event on file not found', async () => {
    const planPath = join(tempDir, 'NONEXISTENT.md');
    const events: unknown[] = [];
    const bus = getEventBus();
    bus.subscribe('plan:error', (event) => events.push(event));

    const store = new PlanStore(planPath);

    try {
      await store.load();
    } catch {
      // Expected
    }

    expect(events).toHaveLength(1);
  });

  test('throws error with line number for malformed ticket', async () => {
    const planContent = `# Test Plan

## 7. Task Backlog

### Ticket: T001 Task
- **Priority:** P0
- **Status:** Todo

### Ticket: T002 Bad Task
- **Priority:** INVALID
- **Status:** Todo
`;

    const planPath = join(tempDir, 'PLAN.md');
    await writeFile(planPath, planContent);

    const store = new PlanStore(planPath);

    await expect(store.load()).rejects.toThrow(/line \d+/i);
    await expect(store.load()).rejects.toThrow(/Invalid priority/i);
  });

  test('getTickets returns parsed tickets', async () => {
    const planContent = `# Plan

## 7. Task Backlog

### Ticket: T001 Task
- **Priority:** P0
- **Status:** Todo
`;

    const planPath = join(tempDir, 'PLAN.md');
    await writeFile(planPath, planContent);

    const store = new PlanStore(planPath);
    await store.load();

    const tickets = store.getTickets();
    expect(tickets).toHaveLength(1);
    expect(tickets[0].id).toBe('T001');
  });

  test('getTicket returns specific ticket by ID', async () => {
    const planContent = `# Plan

## 7. Task Backlog

### Ticket: T001 First
- **Priority:** P0
- **Status:** Todo

### Ticket: T002 Second
- **Priority:** P1
- **Status:** InProgress
`;

    const planPath = join(tempDir, 'PLAN.md');
    await writeFile(planPath, planContent);

    const store = new PlanStore(planPath);
    await store.load();

    const ticket = store.getTicket('T002');
    expect(ticket).toBeDefined();
    expect(ticket!.title).toBe('Second');
    expect(ticket!.status).toBe('InProgress');

    const missing = store.getTicket('T999');
    expect(missing).toBeUndefined();
  });

  test('throws error if getPlan called before load', () => {
    const store = new PlanStore('/fake/path');

    expect(() => store.getPlan()).toThrow('Plan not loaded');
  });
});

describe('validatePlan', () => {
  test('detects duplicate ticket IDs', () => {
    const plan: ParsedPlan = {
      overview: '',
      definitionOfDone: [],
      epics: [],
      tickets: [
        { id: 'T001', title: 'First', priority: 'P0', status: 'Todo', dependencies: [], acceptanceCriteria: [], validationSteps: [] },
        { id: 'T001', title: 'Duplicate', priority: 'P1', status: 'Todo', dependencies: [], acceptanceCriteria: [], validationSteps: [] },
      ],
      rawContent: '',
    };

    const errors = validatePlan(plan);

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Duplicate ticket ID');
    expect(errors[0].message).toContain('T001');
  });

  test('detects invalid dependencies', () => {
    const plan: ParsedPlan = {
      overview: '',
      definitionOfDone: [],
      epics: [],
      tickets: [
        { id: 'T001', title: 'First', priority: 'P0', status: 'Todo', dependencies: ['T999'], acceptanceCriteria: [], validationSteps: [] },
      ],
      rawContent: '',
    };

    const errors = validatePlan(plan);

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('invalid dependency');
    expect(errors[0].message).toContain('T999');
  });

  test('returns empty array for valid plan', () => {
    const plan: ParsedPlan = {
      overview: '',
      definitionOfDone: [],
      epics: [],
      tickets: [
        { id: 'T001', title: 'First', priority: 'P0', status: 'Done', dependencies: [], acceptanceCriteria: [], validationSteps: [] },
        { id: 'T002', title: 'Second', priority: 'P0', status: 'Todo', dependencies: ['T001'], acceptanceCriteria: [], validationSteps: [] },
      ],
      rawContent: '',
    };

    const errors = validatePlan(plan);

    expect(errors).toHaveLength(0);
  });
});

describe('PlanStore with real PLAN.md', () => {
  test('parses the actual PLAN.md from the project', async () => {
    // This test validates the parser works with the real PLAN.md
    const planPath = join(import.meta.dir, '../..', 'PLAN.md');
    const store = new PlanStore(planPath);

    resetEventBus();
    const plan = await store.load();

    // Should have multiple tickets
    expect(plan.tickets.length).toBeGreaterThan(10);

    // Check for known tickets
    const t001 = store.getTicket('T001');
    expect(t001).toBeDefined();
    expect(t001!.title).toContain('Event Bus');
    expect(t001!.status).toBe('Done');

    const t002 = store.getTicket('T002');
    expect(t002).toBeDefined();
    expect(t002!.title).toContain('Plan Parser');
    expect(t002!.priority).toBe('P0');

    // Validate the plan has no structural errors
    const errors = validatePlan(plan);
    expect(errors).toHaveLength(0);
  });
});

// =============================================================================
// T003: Plan Store - Write Updates Tests
// =============================================================================

import { serializeTicket } from './plan-store';
import { readFile, stat } from 'node:fs/promises';
import type { TicketStatusChangedEvent } from './types';

describe('PlanStore - Write Updates (T003)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'plan-store-write-test-'));
    resetEventBus();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  describe('updateTicketStatus', () => {
    test('updates ticket status in-place', async () => {
      const planContent = `# Test Plan

## 7. Task Backlog

### Ticket: T001 Test Ticket
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
`;

      const planPath = join(tempDir, 'PLAN.md');
      await writeFile(planPath, planContent);

      const store = new PlanStore(planPath);
      await store.load();

      await store.updateTicketStatus('T001', 'InProgress');

      // Read back from file
      const updatedContent = await readFile(planPath, 'utf-8');
      expect(updatedContent).toContain('- **Status:** In Progress');

      // Verify internal state
      const ticket = store.getTicket('T001');
      expect(ticket?.status).toBe('InProgress');
    });

    test('emits ticket:status-changed and plan:updated events', async () => {
      const planContent = `# Test Plan

### Ticket: T001 Test Ticket
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
`;

      const planPath = join(tempDir, 'PLAN.md');
      await writeFile(planPath, planContent);

      const store = new PlanStore(planPath);
      await store.load();

      const statusEvents: unknown[] = [];
      const updateEvents: unknown[] = [];
      getEventBus().subscribe('ticket:status-changed', (e) => statusEvents.push(e));
      getEventBus().subscribe('plan:updated', (e) => updateEvents.push(e));

      await store.updateTicketStatus('T001', 'InProgress');

      expect(statusEvents).toHaveLength(1);
      const statusEvent = statusEvents[0] as TicketStatusChangedEvent;
      expect(statusEvent.ticketId).toBe('T001');
      expect(statusEvent.previousStatus).toBe('Todo');
      expect(statusEvent.newStatus).toBe('InProgress');

      expect(updateEvents).toHaveLength(1);
    });

    test('preserves formatting and other content', async () => {
      const planContent = `# Test Plan

## 1. Overview

This is the overview section.

## 7. Task Backlog

### Ticket: T001 First Ticket
- **Priority:** P0
- **Status:** Todo
- **Owner:** Agent-1
- **Scope:** First ticket description

### Ticket: T002 Second Ticket
- **Priority:** P1
- **Status:** Todo
- **Owner:** Unassigned
- **Scope:** Second ticket description
`;

      const planPath = join(tempDir, 'PLAN.md');
      await writeFile(planPath, planContent);

      const store = new PlanStore(planPath);
      await store.load();

      await store.updateTicketStatus('T001', 'Done');

      // Read back from file
      const updatedContent = await readFile(planPath, 'utf-8');

      // Overview should be preserved
      expect(updatedContent).toContain('This is the overview section.');

      // T001 updated
      expect(updatedContent).toMatch(/### Ticket: T001[\s\S]*?- \*\*Status:\*\* Done/);

      // T002 unchanged
      expect(updatedContent).toMatch(/### Ticket: T002[\s\S]*?- \*\*Status:\*\* Todo/);
    });

    test('does nothing if status is the same', async () => {
      const planContent = `# Test Plan

### Ticket: T001 Test Ticket
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
`;

      const planPath = join(tempDir, 'PLAN.md');
      await writeFile(planPath, planContent);

      const store = new PlanStore(planPath);
      await store.load();

      const events: unknown[] = [];
      getEventBus().subscribe('plan:updated', (e) => events.push(e));

      await store.updateTicketStatus('T001', 'Todo');

      expect(events).toHaveLength(0); // No event emitted
    });

    test('throws error for non-existent ticket', async () => {
      const planContent = `# Test Plan

### Ticket: T001 Test Ticket
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
`;

      const planPath = join(tempDir, 'PLAN.md');
      await writeFile(planPath, planContent);

      const store = new PlanStore(planPath);
      await store.load();

      await expect(store.updateTicketStatus('T999', 'Done')).rejects.toThrow('Ticket not found');
    });

    test('supports all status transitions', async () => {
      const planContent = `# Test Plan

### Ticket: T001 Test Ticket
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
`;

      const planPath = join(tempDir, 'PLAN.md');
      await writeFile(planPath, planContent);

      const store = new PlanStore(planPath);
      await store.load();

      // Todo -> InProgress
      await store.updateTicketStatus('T001', 'InProgress');
      let content = await readFile(planPath, 'utf-8');
      expect(content).toContain('- **Status:** In Progress');

      // InProgress -> Review
      await store.updateTicketStatus('T001', 'Review');
      content = await readFile(planPath, 'utf-8');
      expect(content).toContain('- **Status:** Review');

      // Review -> QA
      await store.updateTicketStatus('T001', 'QA');
      content = await readFile(planPath, 'utf-8');
      expect(content).toContain('- **Status:** QA');

      // QA -> Done
      await store.updateTicketStatus('T001', 'Done');
      content = await readFile(planPath, 'utf-8');
      expect(content).toContain('- **Status:** Done');
    });
  });

  describe('updateTicketOwner', () => {
    test('updates ticket owner in-place', async () => {
      const planContent = `# Test Plan

### Ticket: T001 Test Ticket
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
`;

      const planPath = join(tempDir, 'PLAN.md');
      await writeFile(planPath, planContent);

      const store = new PlanStore(planPath);
      await store.load();

      await store.updateTicketOwner('T001', 'Agent-42');

      // Read back from file
      const updatedContent = await readFile(planPath, 'utf-8');
      expect(updatedContent).toContain('- **Owner:** Agent-42');

      // Verify internal state
      const ticket = store.getTicket('T001');
      expect(ticket?.owner).toBe('Agent-42');
    });

    test('sets to Unassigned when owner is empty', async () => {
      const planContent = `# Test Plan

### Ticket: T001 Test Ticket
- **Priority:** P0
- **Status:** Todo
- **Owner:** Agent-1
`;

      const planPath = join(tempDir, 'PLAN.md');
      await writeFile(planPath, planContent);

      const store = new PlanStore(planPath);
      await store.load();

      await store.updateTicketOwner('T001', '');

      // Read back from file
      const updatedContent = await readFile(planPath, 'utf-8');
      expect(updatedContent).toContain('- **Owner:** Unassigned');

      // Verify internal state
      const ticket = store.getTicket('T001');
      expect(ticket?.owner).toBeUndefined();
    });

    test('emits plan:updated event', async () => {
      const planContent = `# Test Plan

### Ticket: T001 Test Ticket
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
`;

      const planPath = join(tempDir, 'PLAN.md');
      await writeFile(planPath, planContent);

      const store = new PlanStore(planPath);
      await store.load();

      const events: unknown[] = [];
      getEventBus().subscribe('plan:updated', (e) => events.push(e));

      await store.updateTicketOwner('T001', 'Agent-1');

      expect(events).toHaveLength(1);
    });

    test('throws error for non-existent ticket', async () => {
      const planContent = `# Test Plan

### Ticket: T001 Test Ticket
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
`;

      const planPath = join(tempDir, 'PLAN.md');
      await writeFile(planPath, planContent);

      const store = new PlanStore(planPath);
      await store.load();

      await expect(store.updateTicketOwner('T999', 'Agent-1')).rejects.toThrow('Ticket not found');
    });
  });

  describe('addTicketFeedback', () => {
    test('adds feedback when Notes field exists but is empty', async () => {
      const planContent = `# Test Plan

### Ticket: T001 Test Ticket
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
- **Notes:**
`;

      const planPath = join(tempDir, 'PLAN.md');
      await writeFile(planPath, planContent);

      const store = new PlanStore(planPath);
      await store.load();

      await store.addTicketFeedback('T001', 'This is feedback');

      // Read back from file
      const updatedContent = await readFile(planPath, 'utf-8');
      expect(updatedContent).toContain('- **Notes:** This is feedback');

      // Verify internal state
      const ticket = store.getTicket('T001');
      expect(ticket?.notes).toBe('This is feedback');
    });

    test('appends to existing notes', async () => {
      const planContent = `# Test Plan

### Ticket: T001 Test Ticket
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
- **Notes:** Existing notes
`;

      const planPath = join(tempDir, 'PLAN.md');
      await writeFile(planPath, planContent);

      const store = new PlanStore(planPath);
      await store.load();

      await store.addTicketFeedback('T001', 'New feedback');

      // Read back from file
      const updatedContent = await readFile(planPath, 'utf-8');
      expect(updatedContent).toContain('Existing notes');
      expect(updatedContent).toContain('New feedback');

      // Verify internal state
      const ticket = store.getTicket('T001');
      expect(ticket?.notes).toContain('Existing notes');
      expect(ticket?.notes).toContain('New feedback');
    });

    test('adds Notes field when it does not exist', async () => {
      const planContent = `# Test Plan

### Ticket: T001 Test Ticket
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned

### Ticket: T002 Second Ticket
- **Priority:** P1
- **Status:** Todo
- **Owner:** Unassigned
`;

      const planPath = join(tempDir, 'PLAN.md');
      await writeFile(planPath, planContent);

      const store = new PlanStore(planPath);
      await store.load();

      await store.addTicketFeedback('T001', 'New notes added');

      // Read back from file
      const updatedContent = await readFile(planPath, 'utf-8');
      expect(updatedContent).toContain('- **Notes:** New notes added');

      // Verify T002 is still intact
      expect(updatedContent).toContain('### Ticket: T002');
    });

    test('emits plan:updated event', async () => {
      const planContent = `# Test Plan

### Ticket: T001 Test Ticket
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
- **Notes:**
`;

      const planPath = join(tempDir, 'PLAN.md');
      await writeFile(planPath, planContent);

      const store = new PlanStore(planPath);
      await store.load();

      const events: unknown[] = [];
      getEventBus().subscribe('plan:updated', (e) => events.push(e));

      await store.addTicketFeedback('T001', 'Feedback');

      expect(events).toHaveLength(1);
    });

    test('throws error for non-existent ticket', async () => {
      const planContent = `# Test Plan

### Ticket: T001 Test Ticket
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
`;

      const planPath = join(tempDir, 'PLAN.md');
      await writeFile(planPath, planContent);

      const store = new PlanStore(planPath);
      await store.load();

      await expect(store.addTicketFeedback('T999', 'Feedback')).rejects.toThrow('Ticket not found');
    });
  });

  describe('atomic writes', () => {
    test('update is atomic (temp file + rename)', async () => {
      const planContent = `# Test Plan

### Ticket: T001 Test Ticket
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
`;

      const planPath = join(tempDir, 'PLAN.md');
      await writeFile(planPath, planContent);

      const store = new PlanStore(planPath);
      await store.load();

      // Perform update
      await store.updateTicketStatus('T001', 'Done');

      // Verify no temp file left behind
      await expect(stat(`${planPath}.tmp`)).rejects.toThrow();

      // Verify the file was updated
      const updatedContent = await readFile(planPath, 'utf-8');
      expect(updatedContent).toContain('- **Status:** Done');
    });
  });

  describe('concurrent operations', () => {
    test('sequential updates apply correctly', async () => {
      const planContent = `# Test Plan

### Ticket: T001 First Ticket
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned

### Ticket: T002 Second Ticket
- **Priority:** P1
- **Status:** Todo
- **Owner:** Unassigned

### Ticket: T003 Third Ticket
- **Priority:** P2
- **Status:** Todo
- **Owner:** Unassigned
`;

      const planPath = join(tempDir, 'PLAN.md');
      await writeFile(planPath, planContent);

      const store = new PlanStore(planPath);
      await store.load();

      // Perform sequential updates
      await store.updateTicketStatus('T001', 'InProgress');
      await store.updateTicketOwner('T002', 'Agent-1');
      await store.updateTicketStatus('T003', 'Done');

      // Reload and verify all changes were applied
      const store2 = new PlanStore(planPath);
      await store2.load();

      expect(store2.getTicket('T001')?.status).toBe('InProgress');
      expect(store2.getTicket('T002')?.owner).toBe('Agent-1');
      expect(store2.getTicket('T003')?.status).toBe('Done');
    });
  });
});

describe('serializeTicket', () => {
  test('serializes a complete ticket', () => {
    const ticket: Ticket = {
      id: 'T001',
      title: 'Test Ticket',
      description: 'A test description',
      priority: 'P0',
      status: 'InProgress',
      owner: 'Agent-1',
      epic: 'core',
      dependencies: ['T000'],
      acceptanceCriteria: ['Criterion 1', 'Criterion 2'],
      validationSteps: ['Step 1', 'Step 2'],
      notes: 'Some notes',
    };

    const markdown = serializeTicket(ticket);

    expect(markdown).toContain('### Ticket: T001 Test Ticket');
    expect(markdown).toContain('- **Priority:** P0');
    expect(markdown).toContain('- **Status:** In Progress');
    expect(markdown).toContain('- **Owner:** Agent-1');
    expect(markdown).toContain('- **Epic:** core');
    expect(markdown).toContain('- **Scope:** A test description');
    expect(markdown).toContain('- **Acceptance Criteria:**');
    expect(markdown).toContain('  - Criterion 1');
    expect(markdown).toContain('  - Criterion 2');
    expect(markdown).toContain('- **Validation Steps:**');
    expect(markdown).toContain('  - Step 1');
    expect(markdown).toContain('  - Step 2');
    expect(markdown).toContain('- **Dependencies:** T000');
    expect(markdown).toContain('- **Notes:** Some notes');
  });

  test('serializes a minimal ticket', () => {
    const ticket: Ticket = {
      id: 'T002',
      title: 'Minimal Ticket',
      priority: 'P1',
      status: 'Todo',
      dependencies: [],
      acceptanceCriteria: [],
      validationSteps: [],
    };

    const markdown = serializeTicket(ticket);

    expect(markdown).toContain('### Ticket: T002 Minimal Ticket');
    expect(markdown).toContain('- **Priority:** P1');
    expect(markdown).toContain('- **Status:** Todo');
    expect(markdown).toContain('- **Owner:** Unassigned');
    expect(markdown).not.toContain('- **Epic:**');
    expect(markdown).not.toContain('- **Scope:**');
    expect(markdown).not.toContain('- **Acceptance Criteria:**');
    expect(markdown).not.toContain('- **Validation Steps:**');
    expect(markdown).not.toContain('- **Dependencies:**');
    expect(markdown).not.toContain('- **Notes:**');
  });

  test('roundtrip: serialize then parse', () => {
    const original: Ticket = {
      id: 'T003',
      title: 'Roundtrip Test',
      description: 'Test roundtrip serialization',
      priority: 'P2',
      status: 'Review',
      owner: 'Agent-5',
      dependencies: ['T001', 'T002'],
      acceptanceCriteria: ['AC1', 'AC2'],
      validationSteps: ['VS1'],
      notes: 'Test notes',
    };

    const markdown = serializeTicket(original);
    const parsed = parseTicket(markdown, 1);

    // parseTicket returns Ticket | ParseError
    if ('line' in parsed && 'message' in parsed) {
      throw new Error(`Parse error: ${parsed.message}`);
    }

    expect(parsed.id).toBe(original.id);
    expect(parsed.title).toBe(original.title);
    expect(parsed.description).toBe(original.description);
    expect(parsed.priority).toBe(original.priority);
    expect(parsed.status).toBe(original.status);
    expect(parsed.owner).toBe(original.owner);
    expect(parsed.dependencies).toEqual(original.dependencies);
    expect(parsed.acceptanceCriteria).toEqual(original.acceptanceCriteria);
    expect(parsed.validationSteps).toEqual(original.validationSteps);
    expect(parsed.notes).toBe(original.notes);
  });
});
