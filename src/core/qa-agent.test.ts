/**
 * Unit tests for QA Agent
 * Implements: T027 validation
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  QAAgent,
  parseQADecision,
  buildQAPromptFromTemplate,
  QA_PROMPT_TEMPLATE,
} from './qa-agent';
import { AgentManager } from './agent-manager';
import { resetEventBus, getEventBus } from './events';
import type { Ticket, OrchEvent } from './types';

// Helper to create test tickets
const createTicket = (overrides: Partial<Ticket> = {}): Ticket => ({
  id: 'T001',
  title: 'Test Ticket',
  description: 'Test description',
  priority: 'P0',
  status: 'QA',
  dependencies: [],
  acceptanceCriteria: ['Criteria 1', 'Criteria 2'],
  validationSteps: ['`bun run typecheck`', '`bun test`'],
  ...overrides,
});

describe('QAAgent', () => {
  let qaAgent: QAAgent;
  let agentManager: AgentManager;
  let events: OrchEvent[];

  beforeEach(() => {
    resetEventBus();
    agentManager = new AgentManager(3);
    qaAgent = new QAAgent(agentManager);
    events = [];

    getEventBus().subscribeAll((event) => {
      events.push(event);
    });
  });

  describe('constructor', () => {
    test('creates QAAgent with AgentManager', () => {
      expect(qaAgent).toBeDefined();
    });
  });

  describe('startQA', () => {
    test('returns null for manual mode', async () => {
      const ticket = createTicket();
      const result = await qaAgent.startQA({
        ticket,
        worktreePath: '/tmp/test',
        automationMode: 'manual',
      });

      expect(result).toBeNull();
      // Should emit log entry about manual testing
      const logEvent = events.find(e => e.type === 'log:entry');
      expect(logEvent).toBeDefined();
    });

    test('throws error when cannot spawn due to concurrency', async () => {
      // Create manager with 0 max agents
      const limitedManager = new AgentManager(0);
      const limitedQAAgent = new QAAgent(limitedManager);
      const ticket = createTicket();

      await expect(
        limitedQAAgent.startQA({
          ticket,
          worktreePath: '/tmp/test',
          automationMode: 'automatic',
        })
      ).rejects.toThrow('max concurrency reached');
    });
  });

  describe('parseQAOutput', () => {
    test('parses PASSED decision with test results', () => {
      const output = `
Running QA tests...
=== QA DECISION: PASSED ===
Tests completed:
- [Unit tests]: PASS - All 50 tests passed
- [Integration tests]: PASS - API endpoints verified
Summary: All tests passed successfully
      `;

      const result = qaAgent.parseQAOutput(output);

      expect(result).toBeDefined();
      expect(result?.decision).toBe('PASSED');
      expect(result?.testResults).toBeDefined();
      expect(result?.testResults?.length).toBeGreaterThan(0);
    });

    test('parses FAILED decision with bug report', () => {
      const output = `
Running QA tests...
=== QA DECISION: FAILED ===
Bug Report:
- **Issue**: Test fails on edge case
- **Severity**: major
- **Steps to reproduce**:
  1. Run bun test
  2. Observe failure
- **Expected**: Test should pass
- **Actual**: Test fails with error

Tests completed:
- [Unit tests]: FAIL - 2 tests failed
- [Integration tests]: PASS
      `;

      const result = qaAgent.parseQAOutput(output);

      expect(result).toBeDefined();
      expect(result?.decision).toBe('FAILED');
      expect(result?.bugReport).toBeDefined();
      expect(result?.bugReport).toContain('Test fails on edge case');
    });

    test('returns null for output without decision marker', () => {
      const output = `
Running QA tests...
No decision marker here
      `;

      const result = qaAgent.parseQAOutput(output);

      expect(result).toBeNull();
    });
  });
});

describe('parseQADecision', () => {
  test('detects PASSED decision', () => {
    const output = '=== QA DECISION: PASSED ===\nAll tests passed';
    const result = parseQADecision(output);

    expect(result.decision).toBe('PASSED');
  });

  test('detects FAILED decision', () => {
    const output = '=== QA DECISION: FAILED ===\nTests failed';
    const result = parseQADecision(output);

    expect(result.decision).toBe('FAILED');
  });

  test('handles case insensitive matching', () => {
    const output = '=== qa decision: passed ===';
    const result = parseQADecision(output);

    expect(result.decision).toBe('PASSED');
  });

  test('returns null decision for no marker', () => {
    const output = 'No decision here';
    const result = parseQADecision(output);

    expect(result.decision).toBeNull();
  });

  test('extracts test results from PASSED output', () => {
    const output = `
=== QA DECISION: PASSED ===
Tests completed:
- [Unit tests]: PASS - All passed
- [Integration tests]: PASS
    `;

    const result = parseQADecision(output);

    expect(result.decision).toBe('PASSED');
    expect(result.testResults).toBeDefined();
    expect(result.testResults?.length).toBe(2);
    expect(result.testResults?.[0].name).toBe('Unit tests');
    expect(result.testResults?.[0].passed).toBe(true);
    expect(result.testResults?.[0].notes).toBe('All passed');
  });

  test('extracts test results with FAIL entries', () => {
    const output = `
=== QA DECISION: FAILED ===
Bug Report:
- **Issue**: Something failed

Tests completed:
- [Unit tests]: PASS - 48/50 passed
- [Integration tests]: FAIL - API endpoint broken
    `;

    const result = parseQADecision(output);

    expect(result.decision).toBe('FAILED');
    expect(result.testResults?.length).toBe(2);
    expect(result.testResults?.[0].passed).toBe(true);
    expect(result.testResults?.[1].passed).toBe(false);
    expect(result.testResults?.[1].notes).toBe('API endpoint broken');
  });

  test('extracts bug report from FAILED output', () => {
    const output = `
=== QA DECISION: FAILED ===
Bug Report:
- **Issue**: Null pointer exception
- **Severity**: critical
- **Expected**: Should handle null gracefully
- **Actual**: Crashes with unhandled exception

Tests completed:
- [Error handling]: FAIL
    `;

    const result = parseQADecision(output);

    expect(result.decision).toBe('FAILED');
    expect(result.bugReport).toBeDefined();
    expect(result.bugReport).toContain('Null pointer exception');
    expect(result.bugReport).toContain('critical');
  });

  test('handles output with only decision marker', () => {
    const output = '=== QA DECISION: PASSED ===';
    const result = parseQADecision(output);

    expect(result.decision).toBe('PASSED');
    expect(result.testResults).toEqual([]);
  });
});

describe('buildQAPromptFromTemplate', () => {
  test('builds prompt with all ticket fields', () => {
    const ticket = createTicket({
      id: 'T042',
      title: 'Implement Feature X',
      description: 'Add new feature X to the system',
      acceptanceCriteria: ['Feature works', 'No regressions'],
      validationSteps: ['Run tests', 'Manual verification'],
    });

    const prompt = buildQAPromptFromTemplate(ticket, '/project/workspace');

    expect(prompt).toContain('T042');
    expect(prompt).toContain('Implement Feature X');
    expect(prompt).toContain('Add new feature X to the system');
    expect(prompt).toContain('Feature works');
    expect(prompt).toContain('No regressions');
    expect(prompt).toContain('Run tests');
    expect(prompt).toContain('Manual verification');
    expect(prompt).toContain('/project/workspace');
    expect(prompt).toContain('=== QA DECISION: PASSED ===');
    expect(prompt).toContain('=== QA DECISION: FAILED ===');
  });

  test('uses title as description when description is missing', () => {
    const ticket = createTicket({
      id: 'T043',
      title: 'Title Only Feature',
      description: undefined,
    });

    const prompt = buildQAPromptFromTemplate(ticket, '/workspace');

    expect(prompt).toContain('Title Only Feature');
  });

  test('handles empty acceptance criteria', () => {
    const ticket = createTicket({
      acceptanceCriteria: [],
    });

    const prompt = buildQAPromptFromTemplate(ticket, '/workspace');

    expect(prompt).toContain('No specific criteria defined');
  });

  test('handles empty validation steps', () => {
    const ticket = createTicket({
      validationSteps: [],
    });

    const prompt = buildQAPromptFromTemplate(ticket, '/workspace');

    expect(prompt).toContain('Verify basic functionality works as expected');
  });

  test('numbers validation steps', () => {
    const ticket = createTicket({
      validationSteps: ['First step', 'Second step', 'Third step'],
    });

    const prompt = buildQAPromptFromTemplate(ticket, '/workspace');

    expect(prompt).toContain('1. First step');
    expect(prompt).toContain('2. Second step');
    expect(prompt).toContain('3. Third step');
  });

  test('formats acceptance criteria as bullet points', () => {
    const ticket = createTicket({
      acceptanceCriteria: ['Must work', 'Must be fast', 'Must be secure'],
    });

    const prompt = buildQAPromptFromTemplate(ticket, '/workspace');

    expect(prompt).toContain('- Must work');
    expect(prompt).toContain('- Must be fast');
    expect(prompt).toContain('- Must be secure');
  });
});

describe('QA_PROMPT_TEMPLATE', () => {
  test('contains all required sections', () => {
    expect(QA_PROMPT_TEMPLATE).toContain('Ticket Context');
    expect(QA_PROMPT_TEMPLATE).toContain('Acceptance Criteria');
    expect(QA_PROMPT_TEMPLATE).toContain('Validation Steps');
    expect(QA_PROMPT_TEMPLATE).toContain('Working Directory');
    expect(QA_PROMPT_TEMPLATE).toContain('Testing Guidelines');
    expect(QA_PROMPT_TEMPLATE).toContain('Output Format');
  });

  test('contains QA decision markers', () => {
    expect(QA_PROMPT_TEMPLATE).toContain('=== QA DECISION: PASSED ===');
    expect(QA_PROMPT_TEMPLATE).toContain('=== QA DECISION: FAILED ===');
  });

  test('contains bug report template', () => {
    expect(QA_PROMPT_TEMPLATE).toContain('Bug Report');
    expect(QA_PROMPT_TEMPLATE).toContain('**Issue**');
    expect(QA_PROMPT_TEMPLATE).toContain('**Steps to reproduce**');
    expect(QA_PROMPT_TEMPLATE).toContain('**Expected**');
    expect(QA_PROMPT_TEMPLATE).toContain('**Actual**');
  });
});

describe('Integration: QA flow scenarios', () => {
  test('ticket flows from QA to Done on PASSED', () => {
    // Simulate agent output for passed QA
    const output = `
I'll run the QA tests for this ticket.

Running typecheck...
All types validated successfully.

Running tests...
bun test v1.0.0

test/feature.test.ts:
  describe feature
    passes test case 1
    passes test case 2
    passes test case 3

All 3 tests passed!

=== QA DECISION: PASSED ===
Tests completed:
- [Typecheck]: PASS - No type errors found
- [Unit tests]: PASS - All 3 tests passed
- [Manual verification]: PASS - Feature works as expected

Summary: All acceptance criteria verified and tests passing.
    `;

    const result = parseQADecision(output);

    expect(result.decision).toBe('PASSED');
    expect(result.testResults?.every(t => t.passed)).toBe(true);
    // In real flow, this would trigger ticket.status = 'Done'
  });

  test('ticket flows from QA to InProgress on FAILED with bug report', () => {
    // Simulate agent output for failed QA
    const output = `
I'll run the QA tests for this ticket.

Running typecheck...
Type error found in src/feature.ts:42

Running tests...
bun test v1.0.0

test/feature.test.ts:
  describe feature
    passes test case 1
    FAILS test case 2
    passes test case 3

1 test failed!

=== QA DECISION: FAILED ===
Bug Report:
- **Issue**: Type error in feature.ts prevents compilation
- **Severity**: critical
- **Steps to reproduce**:
  1. Run bun run typecheck
  2. Observe error on line 42
- **Expected**: No type errors
- **Actual**: Type 'string' is not assignable to type 'number'
- **Suggested fix**: Change the type annotation on line 42

Tests completed:
- [Typecheck]: FAIL - Type error on line 42
- [Unit tests]: FAIL - 1 test failed
- [Manual verification]: PASS - Feature logic works when type is fixed
    `;

    const result = parseQADecision(output);

    expect(result.decision).toBe('FAILED');
    expect(result.bugReport).toContain('Type error');
    expect(result.bugReport).toContain('critical');
    expect(result.testResults?.some(t => !t.passed)).toBe(true);
    // In real flow, this would trigger:
    // ticket.status = 'InProgress'
    // ticket.feedback = result.bugReport
  });
});
