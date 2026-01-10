/**
 * Unit tests for ReviewAgent
 * Implements: T026 validation
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  ReviewAgent,
  parseReviewDecision,
  isApproved,
  isChangesRequested,
  formatReviewFeedback,
} from './review-agent';
import { resetEventBus, getEventBus } from './events';
import type { Ticket, OrchConfig, OrchEvent, ReviewResult } from './types';
import { buildReviewPrompt } from './agent-manager';

// Helper to create a test config
function createTestConfig(overrides?: Partial<OrchConfig>): OrchConfig {
  return {
    maxAgents: 5,
    agentModel: 'sonnet',
    planFile: 'PLAN.md',
    logLevel: 'info',
    automation: {
      ticketProgression: 'automatic',
      review: { mode: 'automatic' },
      qa: { mode: 'automatic' },
    },
    ...overrides,
  };
}

// Helper to create a test ticket
function createTestTicket(overrides?: Partial<Ticket>): Ticket {
  return {
    id: 'T001',
    title: 'Test Ticket',
    description: 'Test description',
    priority: 'P0',
    status: 'Review',
    dependencies: [],
    acceptanceCriteria: ['Feature works correctly', 'Tests pass'],
    validationSteps: ['bun test'],
    ...overrides,
  };
}

describe('ReviewAgent', () => {
  let reviewAgent: ReviewAgent;
  let events: OrchEvent[];

  beforeEach(() => {
    resetEventBus();
    events = [];
    getEventBus().subscribeAll((event) => {
      events.push(event);
    });

    reviewAgent = new ReviewAgent({
      config: createTestConfig(),
      projectRoot: '/tmp/test-project',
    });
  });

  afterEach(async () => {
    await reviewAgent.stopAll();
  });

  describe('constructor', () => {
    test('creates review agent with config', () => {
      expect(reviewAgent).toBeDefined();
      expect(reviewAgent.shouldAutoSpawn()).toBe(true);
    });
  });

  describe('shouldAutoSpawn', () => {
    test('returns true when mode is automatic', () => {
      const agent = new ReviewAgent({
        config: createTestConfig({
          automation: {
            ticketProgression: 'automatic',
            review: { mode: 'automatic' },
            qa: { mode: 'automatic' },
          },
        }),
        projectRoot: '/tmp',
      });
      expect(agent.shouldAutoSpawn()).toBe(true);
    });

    test('returns false when mode is approval', () => {
      const agent = new ReviewAgent({
        config: createTestConfig({
          automation: {
            ticketProgression: 'automatic',
            review: { mode: 'approval' },
            qa: { mode: 'automatic' },
          },
        }),
        projectRoot: '/tmp',
      });
      expect(agent.shouldAutoSpawn()).toBe(false);
    });

    test('returns false when mode is manual', () => {
      const agent = new ReviewAgent({
        config: createTestConfig({
          automation: {
            ticketProgression: 'automatic',
            review: { mode: 'manual' },
            qa: { mode: 'automatic' },
          },
        }),
        projectRoot: '/tmp',
      });
      expect(agent.shouldAutoSpawn()).toBe(false);
    });
  });

  describe('requiresApproval', () => {
    test('returns true when mode is approval', () => {
      const agent = new ReviewAgent({
        config: createTestConfig({
          automation: {
            ticketProgression: 'automatic',
            review: { mode: 'approval' },
            qa: { mode: 'automatic' },
          },
        }),
        projectRoot: '/tmp',
      });
      expect(agent.requiresApproval()).toBe(true);
    });

    test('returns false when mode is automatic', () => {
      expect(reviewAgent.requiresApproval()).toBe(false);
    });
  });

  describe('isManual', () => {
    test('returns true when mode is manual', () => {
      const agent = new ReviewAgent({
        config: createTestConfig({
          automation: {
            ticketProgression: 'automatic',
            review: { mode: 'manual' },
            qa: { mode: 'automatic' },
          },
        }),
        projectRoot: '/tmp',
      });
      expect(agent.isManual()).toBe(true);
    });

    test('returns false when mode is automatic', () => {
      expect(reviewAgent.isManual()).toBe(false);
    });
  });

  describe('startReview', () => {
    test('returns null in manual mode', async () => {
      const result = await reviewAgent.startReview({
        ticket: createTestTicket(),
        worktreePath: '/tmp/test-project',
        automationMode: 'manual',
      });
      expect(result).toBeNull();
    });
  });

  describe('getAgent', () => {
    test('returns undefined for non-existent agent', () => {
      expect(reviewAgent.getAgent('non-existent')).toBeUndefined();
    });
  });

  describe('getAllAgents', () => {
    test('returns empty array when no agents', () => {
      expect(reviewAgent.getAllAgents()).toEqual([]);
    });
  });

  describe('getOutput', () => {
    test('returns empty string for non-existent agent', () => {
      expect(reviewAgent.getOutput('non-existent')).toBe('');
    });
  });

  describe('stop', () => {
    test('throws error for non-existent agent', async () => {
      await expect(reviewAgent.stop('non-existent')).rejects.toThrow(
        'Review agent not found'
      );
    });
  });
});

describe('parseReviewDecision', () => {
  describe('APPROVED decision', () => {
    test('parses APPROVED with feedback', () => {
      const output = `
I've reviewed the code changes.

=== REVIEW DECISION: APPROVED ===
The implementation looks good. All acceptance criteria are met.
Code quality is high and follows existing patterns.
      `;

      const result = parseReviewDecision(output);

      expect(result.decision).toBe('APPROVED');
      expect(result.feedback).toContain('implementation looks good');
    });

    test('parses APPROVED without feedback', () => {
      const output = '=== REVIEW DECISION: APPROVED ===';

      const result = parseReviewDecision(output);

      expect(result.decision).toBe('APPROVED');
      expect(result.feedback).toBeUndefined();
    });

    test('handles case insensitive APPROVED', () => {
      const output = '=== review decision: approved ===\nLooks good';

      const result = parseReviewDecision(output);

      expect(result.decision).toBe('APPROVED');
    });

    test('handles extra whitespace in APPROVED marker', () => {
      const output = '===  REVIEW DECISION:  APPROVED  ===\nSummary here';

      const result = parseReviewDecision(output);

      expect(result.decision).toBe('APPROVED');
    });
  });

  describe('CHANGES_REQUESTED decision', () => {
    test('parses CHANGES_REQUESTED with feedback', () => {
      const output = `
I've reviewed the code changes.

=== REVIEW DECISION: CHANGES_REQUESTED ===
The following issues need to be addressed:
- Missing error handling in the main function
- Variable naming could be improved
- Tests are incomplete
      `;

      const result = parseReviewDecision(output);

      expect(result.decision).toBe('CHANGES_REQUESTED');
      expect(result.feedback).toContain('Missing error handling');
      expect(result.feedback).toContain('Variable naming');
    });

    test('parses CHANGES_REQUESTED without feedback', () => {
      const output = '=== REVIEW DECISION: CHANGES_REQUESTED ===';

      const result = parseReviewDecision(output);

      expect(result.decision).toBe('CHANGES_REQUESTED');
      expect(result.feedback).toBeUndefined();
    });

    test('handles case insensitive CHANGES_REQUESTED', () => {
      const output = '=== review decision: changes_requested ===\nFix these issues';

      const result = parseReviewDecision(output);

      expect(result.decision).toBe('CHANGES_REQUESTED');
    });
  });

  describe('no decision', () => {
    test('returns null decision when no marker present', () => {
      const output = 'Just some regular output without any decision marker.';

      const result = parseReviewDecision(output);

      expect(result.decision).toBeNull();
      expect(result.feedback).toBeUndefined();
    });

    test('returns null for partial markers', () => {
      const output = '=== REVIEW DECISION: ===';

      const result = parseReviewDecision(output);

      expect(result.decision).toBeNull();
    });

    test('returns null for malformed markers', () => {
      const output = 'REVIEW DECISION: APPROVED';

      const result = parseReviewDecision(output);

      expect(result.decision).toBeNull();
    });

    test('handles empty output', () => {
      const result = parseReviewDecision('');

      expect(result.decision).toBeNull();
    });
  });

  describe('edge cases', () => {
    test('stops extracting feedback at next marker', () => {
      const output = `
=== REVIEW DECISION: APPROVED ===
Summary here
=== SOME OTHER MARKER ===
This should not be included
      `;

      const result = parseReviewDecision(output);

      expect(result.decision).toBe('APPROVED');
      expect(result.feedback).toBe('Summary here');
      expect(result.feedback).not.toContain('SOME OTHER MARKER');
      expect(result.feedback).not.toContain('should not be included');
    });

    test('handles multiline feedback', () => {
      const output = `
=== REVIEW DECISION: CHANGES_REQUESTED ===
Issue 1: Missing validation
Issue 2: Typo in function name
Issue 3: Unused import
      `;

      const result = parseReviewDecision(output);

      expect(result.decision).toBe('CHANGES_REQUESTED');
      expect(result.feedback).toContain('Issue 1');
      expect(result.feedback).toContain('Issue 2');
      expect(result.feedback).toContain('Issue 3');
    });

    test('prioritizes APPROVED if both markers somehow present (takes first)', () => {
      const output = `
=== REVIEW DECISION: APPROVED ===
Good work
=== REVIEW DECISION: CHANGES_REQUESTED ===
Actually, changes needed
      `;

      const result = parseReviewDecision(output);

      // APPROVED appears first, so it should be matched
      expect(result.decision).toBe('APPROVED');
    });
  });
});

describe('isApproved', () => {
  test('returns true for APPROVED decision', () => {
    const result: ReviewResult = { decision: 'APPROVED' };
    expect(isApproved(result)).toBe(true);
  });

  test('returns false for CHANGES_REQUESTED decision', () => {
    const result: ReviewResult = { decision: 'CHANGES_REQUESTED' };
    expect(isApproved(result)).toBe(false);
  });
});

describe('isChangesRequested', () => {
  test('returns true for CHANGES_REQUESTED decision', () => {
    const result: ReviewResult = { decision: 'CHANGES_REQUESTED' };
    expect(isChangesRequested(result)).toBe(true);
  });

  test('returns false for APPROVED decision', () => {
    const result: ReviewResult = { decision: 'APPROVED' };
    expect(isChangesRequested(result)).toBe(false);
  });
});

describe('formatReviewFeedback', () => {
  test('formats APPROVED with feedback', () => {
    const result: ReviewResult = {
      decision: 'APPROVED',
      feedback: 'Great implementation!',
    };

    expect(formatReviewFeedback(result)).toBe('Great implementation!');
  });

  test('formats APPROVED without feedback', () => {
    const result: ReviewResult = { decision: 'APPROVED' };

    expect(formatReviewFeedback(result)).toBe('Review approved');
  });

  test('formats CHANGES_REQUESTED with feedback', () => {
    const result: ReviewResult = {
      decision: 'CHANGES_REQUESTED',
      feedback: 'Please fix the bug',
    };

    const formatted = formatReviewFeedback(result);
    expect(formatted).toContain('Review requested changes:');
    expect(formatted).toContain('Please fix the bug');
  });

  test('formats CHANGES_REQUESTED with issues', () => {
    const result: ReviewResult = {
      decision: 'CHANGES_REQUESTED',
      issues: [
        { severity: 'error', message: 'Missing null check', file: 'index.ts', line: 42 },
        { severity: 'warning', message: 'Unused variable' },
      ],
    };

    const formatted = formatReviewFeedback(result);
    expect(formatted).toContain('[error]');
    expect(formatted).toContain('[index.ts:42]');
    expect(formatted).toContain('Missing null check');
    expect(formatted).toContain('[warning]');
    expect(formatted).toContain('Unused variable');
  });

  test('formats CHANGES_REQUESTED with issues and feedback', () => {
    const result: ReviewResult = {
      decision: 'CHANGES_REQUESTED',
      feedback: 'Additional notes here',
      issues: [{ severity: 'info', message: 'Consider refactoring' }],
    };

    const formatted = formatReviewFeedback(result);
    expect(formatted).toContain('[info]');
    expect(formatted).toContain('Consider refactoring');
    expect(formatted).toContain('Additional notes here');
  });
});

describe('buildReviewPrompt', () => {
  test('builds prompt with all ticket fields', () => {
    const ticket = createTestTicket({
      id: 'T042',
      title: 'Add user authentication',
      description: 'Implement JWT-based authentication',
      notes: 'Use existing auth library',
    });
    const gitDiff = `
diff --git a/src/auth.ts b/src/auth.ts
new file mode 100644
--- /dev/null
+++ b/src/auth.ts
@@ -0,0 +1,10 @@
+export function authenticate() {
+  return true;
+}
    `;

    const prompt = buildReviewPrompt(ticket, gitDiff, '/project');

    expect(prompt).toContain('T042');
    expect(prompt).toContain('Add user authentication');
    expect(prompt).toContain('JWT-based authentication');
    expect(prompt).toContain('Feature works correctly');
    expect(prompt).toContain('Tests pass');
    expect(prompt).toContain(gitDiff);
    expect(prompt).toContain('Use existing auth library');
    expect(prompt).toContain('=== REVIEW DECISION: APPROVED ===');
    expect(prompt).toContain('=== REVIEW DECISION: CHANGES_REQUESTED ===');
  });

  test('builds prompt with minimal ticket', () => {
    const ticket: Ticket = {
      id: 'T001',
      title: 'Simple change',
      priority: 'P1',
      status: 'Review',
      dependencies: [],
      acceptanceCriteria: [],
      validationSteps: [],
    };

    const prompt = buildReviewPrompt(ticket, '', '/project');

    expect(prompt).toContain('T001');
    expect(prompt).toContain('Simple change');
    expect(prompt).toContain('Security');
    expect(prompt).toContain('Bugs');
    expect(prompt).toContain('Code Quality');
  });

  test('includes review checklist sections', () => {
    const ticket = createTestTicket();
    const prompt = buildReviewPrompt(ticket, 'some diff', '/project');

    expect(prompt).toContain('Security');
    expect(prompt).toContain('Bugs');
    expect(prompt).toContain('Code Quality');
    expect(prompt).toContain('Patterns');
  });
});

describe('Integration: Review flow simulation', () => {
  test('simulates approved review flow', () => {
    const ticket = createTestTicket();

    // Simulate review agent output
    const reviewOutput = `
I've carefully reviewed the code changes for ticket T001.

## Security
- No hardcoded credentials found
- Input validation looks good

## Code Quality
- Clean, readable code
- Good function naming

## Patterns
- Follows existing TypeScript patterns

=== REVIEW DECISION: APPROVED ===
The implementation meets all acceptance criteria. Code quality is high
and follows existing patterns in the codebase.
    `;

    // Parse the decision
    const result = parseReviewDecision(reviewOutput);

    expect(result.decision).toBe('APPROVED');
    expect(isApproved({ decision: result.decision!, feedback: result.feedback })).toBe(true);
  });

  test('simulates rejected review flow', () => {
    const ticket = createTestTicket();

    // Simulate review agent output
    const reviewOutput = `
I've reviewed the code changes for ticket T001.

## Security
- Found potential SQL injection in line 42

## Code Quality
- Missing error handling

=== REVIEW DECISION: CHANGES_REQUESTED ===
The following issues need to be addressed before approval:
- Security: Potential SQL injection vulnerability in database query
- Error handling: Missing try-catch block around async operation
- Tests: No unit tests added for the new functionality
    `;

    // Parse the decision
    const result = parseReviewDecision(reviewOutput);

    expect(result.decision).toBe('CHANGES_REQUESTED');
    expect(isChangesRequested({ decision: result.decision!, feedback: result.feedback })).toBe(true);
    expect(result.feedback).toContain('SQL injection');
    expect(result.feedback).toContain('Error handling');
  });
});
