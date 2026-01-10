/**
 * Tests for Ticket Status Pipeline
 *
 * Implements: T028
 */

import { describe, test, expect } from 'bun:test';
import {
  isValidTransition,
  getNextStatus,
  getPreviousStatus,
  canAdvance,
  canReject,
  canRetry,
  isTerminalStatus,
  isActionableStatus,
  isInProgressStatus,
  getValidTargetStatuses,
  assertValidTransition,
  getStatusOrder,
  sortStatusesByOrder,
  attemptTransition,
  getStatusActions,
  STATUS_DESCRIPTIONS,
} from './status-pipeline';
import type { TicketStatus, AutomationConfig } from './types';

// =============================================================================
// isValidTransition tests
// =============================================================================

describe('isValidTransition', () => {
  describe('valid forward transitions', () => {
    test('Todo -> InProgress is valid', () => {
      expect(isValidTransition('Todo', 'InProgress')).toBe(true);
    });

    test('InProgress -> Review is valid', () => {
      expect(isValidTransition('InProgress', 'Review')).toBe(true);
    });

    test('InProgress -> QA is valid (skipping Review)', () => {
      expect(isValidTransition('InProgress', 'QA')).toBe(true);
    });

    test('InProgress -> Done is valid (skipping Review and QA)', () => {
      expect(isValidTransition('InProgress', 'Done')).toBe(true);
    });

    test('InProgress -> Failed is valid', () => {
      expect(isValidTransition('InProgress', 'Failed')).toBe(true);
    });

    test('Review -> QA is valid', () => {
      expect(isValidTransition('Review', 'QA')).toBe(true);
    });

    test('Review -> Done is valid (skipping QA)', () => {
      expect(isValidTransition('Review', 'Done')).toBe(true);
    });

    test('QA -> Done is valid', () => {
      expect(isValidTransition('QA', 'Done')).toBe(true);
    });
  });

  describe('valid rejection transitions', () => {
    test('Review -> Todo is valid (rejection)', () => {
      expect(isValidTransition('Review', 'Todo')).toBe(true);
    });

    test('QA -> Todo is valid (rejection)', () => {
      expect(isValidTransition('QA', 'Todo')).toBe(true);
    });
  });

  describe('valid retry transitions', () => {
    test('Failed -> Todo is valid (retry)', () => {
      expect(isValidTransition('Failed', 'Todo')).toBe(true);
    });
  });

  describe('invalid transitions', () => {
    test('Todo -> Review is invalid (must go through InProgress)', () => {
      expect(isValidTransition('Todo', 'Review')).toBe(false);
    });

    test('Todo -> QA is invalid', () => {
      expect(isValidTransition('Todo', 'QA')).toBe(false);
    });

    test('Todo -> Done is invalid', () => {
      expect(isValidTransition('Todo', 'Done')).toBe(false);
    });

    test('Todo -> Failed is invalid', () => {
      expect(isValidTransition('Todo', 'Failed')).toBe(false);
    });

    test('Done -> anything is invalid', () => {
      expect(isValidTransition('Done', 'Todo')).toBe(false);
      expect(isValidTransition('Done', 'InProgress')).toBe(false);
      expect(isValidTransition('Done', 'Review')).toBe(false);
      expect(isValidTransition('Done', 'QA')).toBe(false);
      expect(isValidTransition('Done', 'Failed')).toBe(false);
    });

    test('Failed -> InProgress is invalid (must go to Todo)', () => {
      expect(isValidTransition('Failed', 'InProgress')).toBe(false);
    });

    test('Failed -> Review is invalid', () => {
      expect(isValidTransition('Failed', 'Review')).toBe(false);
    });

    test('InProgress -> Todo is invalid (can only fail or advance)', () => {
      expect(isValidTransition('InProgress', 'Todo')).toBe(false);
    });

    test('Review -> InProgress is invalid', () => {
      expect(isValidTransition('Review', 'InProgress')).toBe(false);
    });

    test('QA -> Review is invalid (cannot go backwards except to Todo)', () => {
      expect(isValidTransition('QA', 'Review')).toBe(false);
    });

    test('QA -> InProgress is invalid', () => {
      expect(isValidTransition('QA', 'InProgress')).toBe(false);
    });
  });

  describe('same status transitions', () => {
    test('Todo -> Todo is invalid', () => {
      expect(isValidTransition('Todo', 'Todo')).toBe(false);
    });

    test('InProgress -> InProgress is invalid', () => {
      expect(isValidTransition('InProgress', 'InProgress')).toBe(false);
    });

    test('Done -> Done is invalid', () => {
      expect(isValidTransition('Done', 'Done')).toBe(false);
    });
  });
});

// =============================================================================
// getNextStatus tests
// =============================================================================

describe('getNextStatus', () => {
  test('Todo -> InProgress', () => {
    expect(getNextStatus('Todo')).toBe('InProgress');
  });

  test('InProgress -> Review (default)', () => {
    expect(getNextStatus('InProgress')).toBe('Review');
  });

  test('InProgress with review not manual -> Review', () => {
    const config: AutomationConfig = {
      ticketProgression: 'automatic',
      review: { mode: 'automatic' },
      qa: { mode: 'automatic' },
    };
    expect(getNextStatus('InProgress', config)).toBe('Review');
  });

  test('InProgress with review manual, QA not manual -> QA', () => {
    const config: AutomationConfig = {
      ticketProgression: 'automatic',
      review: { mode: 'manual' },
      qa: { mode: 'automatic' },
    };
    expect(getNextStatus('InProgress', config)).toBe('QA');
  });

  test('InProgress with both review and QA manual -> Done', () => {
    const config: AutomationConfig = {
      ticketProgression: 'automatic',
      review: { mode: 'manual' },
      qa: { mode: 'manual' },
    };
    expect(getNextStatus('InProgress', config)).toBe('Done');
  });

  test('Review -> QA (default)', () => {
    expect(getNextStatus('Review')).toBe('QA');
  });

  test('Review with QA not manual -> QA', () => {
    const config: AutomationConfig = {
      ticketProgression: 'automatic',
      review: { mode: 'automatic' },
      qa: { mode: 'automatic' },
    };
    expect(getNextStatus('Review', config)).toBe('QA');
  });

  test('Review with QA manual -> Done', () => {
    const config: AutomationConfig = {
      ticketProgression: 'automatic',
      review: { mode: 'automatic' },
      qa: { mode: 'manual' },
    };
    expect(getNextStatus('Review', config)).toBe('Done');
  });

  test('QA -> Done', () => {
    expect(getNextStatus('QA')).toBe('Done');
  });

  test('Done -> null (terminal)', () => {
    expect(getNextStatus('Done')).toBe(null);
  });

  test('Failed -> Todo (retry)', () => {
    expect(getNextStatus('Failed')).toBe('Todo');
  });
});

// =============================================================================
// getPreviousStatus tests
// =============================================================================

describe('getPreviousStatus', () => {
  test('Review -> Todo (rejection)', () => {
    expect(getPreviousStatus('Review')).toBe('Todo');
  });

  test('QA -> Todo (rejection)', () => {
    expect(getPreviousStatus('QA')).toBe('Todo');
  });

  test('Failed -> Todo (retry)', () => {
    expect(getPreviousStatus('Failed')).toBe('Todo');
  });

  test('Todo -> null (cannot reject)', () => {
    expect(getPreviousStatus('Todo')).toBe(null);
  });

  test('InProgress -> null (cannot reject)', () => {
    expect(getPreviousStatus('InProgress')).toBe(null);
  });

  test('Done -> null (cannot reject)', () => {
    expect(getPreviousStatus('Done')).toBe(null);
  });
});

// =============================================================================
// canAdvance tests
// =============================================================================

describe('canAdvance', () => {
  test('InProgress can advance', () => {
    expect(canAdvance('InProgress')).toBe(true);
  });

  test('Review can advance', () => {
    expect(canAdvance('Review')).toBe(true);
  });

  test('QA can advance', () => {
    expect(canAdvance('QA')).toBe(true);
  });

  test('Todo cannot advance (needs to start first)', () => {
    expect(canAdvance('Todo')).toBe(false);
  });

  test('Done cannot advance (terminal)', () => {
    expect(canAdvance('Done')).toBe(false);
  });

  test('Failed cannot advance (needs retry first)', () => {
    expect(canAdvance('Failed')).toBe(false);
  });
});

// =============================================================================
// canReject tests
// =============================================================================

describe('canReject', () => {
  test('Review can reject', () => {
    expect(canReject('Review')).toBe(true);
  });

  test('QA can reject', () => {
    expect(canReject('QA')).toBe(true);
  });

  test('Todo cannot reject', () => {
    expect(canReject('Todo')).toBe(false);
  });

  test('InProgress cannot reject', () => {
    expect(canReject('InProgress')).toBe(false);
  });

  test('Done cannot reject', () => {
    expect(canReject('Done')).toBe(false);
  });

  test('Failed cannot reject', () => {
    expect(canReject('Failed')).toBe(false);
  });
});

// =============================================================================
// canRetry tests
// =============================================================================

describe('canRetry', () => {
  test('Failed can retry', () => {
    expect(canRetry('Failed')).toBe(true);
  });

  test('Todo cannot retry', () => {
    expect(canRetry('Todo')).toBe(false);
  });

  test('InProgress cannot retry', () => {
    expect(canRetry('InProgress')).toBe(false);
  });

  test('Review cannot retry', () => {
    expect(canRetry('Review')).toBe(false);
  });

  test('QA cannot retry', () => {
    expect(canRetry('QA')).toBe(false);
  });

  test('Done cannot retry', () => {
    expect(canRetry('Done')).toBe(false);
  });
});

// =============================================================================
// isTerminalStatus tests
// =============================================================================

describe('isTerminalStatus', () => {
  test('Done is terminal', () => {
    expect(isTerminalStatus('Done')).toBe(true);
  });

  test('Failed is terminal', () => {
    expect(isTerminalStatus('Failed')).toBe(true);
  });

  test('Todo is not terminal', () => {
    expect(isTerminalStatus('Todo')).toBe(false);
  });

  test('InProgress is not terminal', () => {
    expect(isTerminalStatus('InProgress')).toBe(false);
  });

  test('Review is not terminal', () => {
    expect(isTerminalStatus('Review')).toBe(false);
  });

  test('QA is not terminal', () => {
    expect(isTerminalStatus('QA')).toBe(false);
  });
});

// =============================================================================
// isActionableStatus tests
// =============================================================================

describe('isActionableStatus', () => {
  test('Todo is actionable', () => {
    expect(isActionableStatus('Todo')).toBe(true);
  });

  test('InProgress is not actionable', () => {
    expect(isActionableStatus('InProgress')).toBe(false);
  });

  test('Review is not actionable', () => {
    expect(isActionableStatus('Review')).toBe(false);
  });

  test('QA is not actionable', () => {
    expect(isActionableStatus('QA')).toBe(false);
  });

  test('Done is not actionable', () => {
    expect(isActionableStatus('Done')).toBe(false);
  });

  test('Failed is not actionable', () => {
    expect(isActionableStatus('Failed')).toBe(false);
  });
});

// =============================================================================
// isInProgressStatus tests
// =============================================================================

describe('isInProgressStatus', () => {
  test('InProgress is in-progress', () => {
    expect(isInProgressStatus('InProgress')).toBe(true);
  });

  test('Review is in-progress', () => {
    expect(isInProgressStatus('Review')).toBe(true);
  });

  test('QA is in-progress', () => {
    expect(isInProgressStatus('QA')).toBe(true);
  });

  test('Todo is not in-progress', () => {
    expect(isInProgressStatus('Todo')).toBe(false);
  });

  test('Done is not in-progress', () => {
    expect(isInProgressStatus('Done')).toBe(false);
  });

  test('Failed is not in-progress', () => {
    expect(isInProgressStatus('Failed')).toBe(false);
  });
});

// =============================================================================
// getValidTargetStatuses tests
// =============================================================================

describe('getValidTargetStatuses', () => {
  test('Todo has InProgress as valid target', () => {
    expect(getValidTargetStatuses('Todo')).toEqual(['InProgress']);
  });

  test('InProgress has Review, QA, Done, Failed as valid targets', () => {
    expect(getValidTargetStatuses('InProgress')).toEqual(['Review', 'QA', 'Done', 'Failed']);
  });

  test('Review has QA, Done, Todo as valid targets', () => {
    expect(getValidTargetStatuses('Review')).toEqual(['QA', 'Done', 'Todo']);
  });

  test('QA has Done, Todo as valid targets', () => {
    expect(getValidTargetStatuses('QA')).toEqual(['Done', 'Todo']);
  });

  test('Done has no valid targets', () => {
    expect(getValidTargetStatuses('Done')).toEqual([]);
  });

  test('Failed has Todo as valid target', () => {
    expect(getValidTargetStatuses('Failed')).toEqual(['Todo']);
  });
});

// =============================================================================
// assertValidTransition tests
// =============================================================================

describe('assertValidTransition', () => {
  test('does not throw for valid transition', () => {
    expect(() => assertValidTransition('Todo', 'InProgress')).not.toThrow();
    expect(() => assertValidTransition('InProgress', 'Review')).not.toThrow();
    expect(() => assertValidTransition('Review', 'Todo')).not.toThrow();
  });

  test('throws for invalid transition', () => {
    expect(() => assertValidTransition('Todo', 'Review')).toThrow(/Invalid status transition/);
  });

  test('includes ticket ID in error message', () => {
    expect(() => assertValidTransition('Todo', 'Review', 'T001')).toThrow(/T001/);
  });

  test('shows valid targets in error message', () => {
    expect(() => assertValidTransition('Todo', 'Done')).toThrow(/InProgress/);
  });

  test('throws for terminal state transitions', () => {
    expect(() => assertValidTransition('Done', 'Todo')).toThrow(/Valid transitions from Done: none/);
  });
});

// =============================================================================
// getStatusOrder tests
// =============================================================================

describe('getStatusOrder', () => {
  test('Failed has lowest order (-1)', () => {
    expect(getStatusOrder('Failed')).toBe(-1);
  });

  test('Todo has order 0', () => {
    expect(getStatusOrder('Todo')).toBe(0);
  });

  test('InProgress has order 1', () => {
    expect(getStatusOrder('InProgress')).toBe(1);
  });

  test('Review has order 2', () => {
    expect(getStatusOrder('Review')).toBe(2);
  });

  test('QA has order 3', () => {
    expect(getStatusOrder('QA')).toBe(3);
  });

  test('Done has order 4', () => {
    expect(getStatusOrder('Done')).toBe(4);
  });
});

// =============================================================================
// sortStatusesByOrder tests
// =============================================================================

describe('sortStatusesByOrder', () => {
  test('sorts statuses by pipeline order', () => {
    const unsorted: TicketStatus[] = ['Done', 'Todo', 'QA', 'InProgress', 'Review'];
    const sorted = sortStatusesByOrder(unsorted);
    expect(sorted).toEqual(['Todo', 'InProgress', 'Review', 'QA', 'Done']);
  });

  test('Failed appears first', () => {
    const unsorted: TicketStatus[] = ['Done', 'Failed', 'Todo'];
    const sorted = sortStatusesByOrder(unsorted);
    expect(sorted).toEqual(['Failed', 'Todo', 'Done']);
  });

  test('does not mutate original array', () => {
    const original: TicketStatus[] = ['Done', 'Todo'];
    sortStatusesByOrder(original);
    expect(original).toEqual(['Done', 'Todo']);
  });
});

// =============================================================================
// attemptTransition tests
// =============================================================================

describe('attemptTransition', () => {
  test('returns success for valid transition', () => {
    const result = attemptTransition('Todo', 'InProgress');
    expect(result.success).toBe(true);
    expect(result.from).toBe('Todo');
    expect(result.to).toBe('InProgress');
    expect(result.error).toBeUndefined();
  });

  test('returns failure for invalid transition', () => {
    const result = attemptTransition('Todo', 'Done');
    expect(result.success).toBe(false);
    expect(result.from).toBe('Todo');
    expect(result.to).toBe('Done');
    expect(result.error).toContain('Cannot transition');
  });

  test('error includes valid transitions', () => {
    const result = attemptTransition('Todo', 'Review');
    expect(result.error).toContain('InProgress');
  });
});

// =============================================================================
// getStatusActions tests
// =============================================================================

describe('getStatusActions', () => {
  test('InProgress can approve but not reject', () => {
    const actions = getStatusActions('InProgress');
    expect(actions.canApprove).toBe(true);
    expect(actions.canReject).toBe(false);
    expect(actions.approveTarget).toBe('Review');
    expect(actions.rejectTarget).toBe(null);
  });

  test('Review can approve and reject', () => {
    const actions = getStatusActions('Review');
    expect(actions.canApprove).toBe(true);
    expect(actions.canReject).toBe(true);
    expect(actions.approveTarget).toBe('QA');
    expect(actions.rejectTarget).toBe('Todo');
  });

  test('QA can approve and reject', () => {
    const actions = getStatusActions('QA');
    expect(actions.canApprove).toBe(true);
    expect(actions.canReject).toBe(true);
    expect(actions.approveTarget).toBe('Done');
    expect(actions.rejectTarget).toBe('Todo');
  });

  test('Todo cannot approve or reject', () => {
    const actions = getStatusActions('Todo');
    expect(actions.canApprove).toBe(false);
    expect(actions.canReject).toBe(false);
    expect(actions.approveTarget).toBe(null);
    expect(actions.rejectTarget).toBe(null);
  });

  test('Done cannot approve or reject', () => {
    const actions = getStatusActions('Done');
    expect(actions.canApprove).toBe(false);
    expect(actions.canReject).toBe(false);
    expect(actions.approveTarget).toBe(null);
    expect(actions.rejectTarget).toBe(null);
  });

  test('Failed cannot approve or reject', () => {
    const actions = getStatusActions('Failed');
    expect(actions.canApprove).toBe(false);
    expect(actions.canReject).toBe(false);
    expect(actions.approveTarget).toBe(null);
    expect(actions.rejectTarget).toBe(null);
  });
});

// =============================================================================
// STATUS_DESCRIPTIONS tests
// =============================================================================

describe('STATUS_DESCRIPTIONS', () => {
  test('all statuses have descriptions', () => {
    const statuses: TicketStatus[] = ['Todo', 'InProgress', 'Review', 'QA', 'Done', 'Failed'];
    for (const status of statuses) {
      expect(STATUS_DESCRIPTIONS[status]).toBeDefined();
      expect(typeof STATUS_DESCRIPTIONS[status]).toBe('string');
      expect(STATUS_DESCRIPTIONS[status].length).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// Integration: Full pipeline flow tests
// =============================================================================

describe('Full Pipeline Flow', () => {
  test('Todo -> InProgress -> Review -> QA -> Done', () => {
    let status: TicketStatus = 'Todo';

    // Start work
    expect(isValidTransition(status, 'InProgress')).toBe(true);
    status = 'InProgress';

    // Complete implementation -> Review
    expect(isValidTransition(status, 'Review')).toBe(true);
    status = 'Review';

    // Pass review -> QA
    expect(isValidTransition(status, 'QA')).toBe(true);
    status = 'QA';

    // Pass QA -> Done
    expect(isValidTransition(status, 'Done')).toBe(true);
    status = 'Done';

    // Cannot go further
    expect(isTerminalStatus(status)).toBe(true);
    expect(getNextStatus(status)).toBe(null);
  });

  test('rejection from Review sends back to Todo', () => {
    let status: TicketStatus = 'Review';

    // Reject
    expect(canReject(status)).toBe(true);
    expect(isValidTransition(status, 'Todo')).toBe(true);
    status = 'Todo';

    // Can start again
    expect(isActionableStatus(status)).toBe(true);
    expect(isValidTransition(status, 'InProgress')).toBe(true);
  });

  test('rejection from QA sends back to Todo', () => {
    let status: TicketStatus = 'QA';

    // Reject
    expect(canReject(status)).toBe(true);
    expect(isValidTransition(status, 'Todo')).toBe(true);
    status = 'Todo';

    // Can start again
    expect(isActionableStatus(status)).toBe(true);
  });

  test('failure and retry flow', () => {
    let status: TicketStatus = 'InProgress';

    // Fail
    expect(isValidTransition(status, 'Failed')).toBe(true);
    status = 'Failed';

    // Is terminal but can retry
    expect(isTerminalStatus(status)).toBe(true);
    expect(canRetry(status)).toBe(true);

    // Retry
    expect(isValidTransition(status, 'Todo')).toBe(true);
    status = 'Todo';

    // Can start again
    expect(isActionableStatus(status)).toBe(true);
  });

  test('skip Review and go directly to QA', () => {
    let status: TicketStatus = 'InProgress';

    // Skip Review
    expect(isValidTransition(status, 'QA')).toBe(true);
    status = 'QA';

    // Continue to Done
    expect(isValidTransition(status, 'Done')).toBe(true);
  });

  test('skip both Review and QA', () => {
    let status: TicketStatus = 'InProgress';

    // Skip both
    expect(isValidTransition(status, 'Done')).toBe(true);
    status = 'Done';

    expect(isTerminalStatus(status)).toBe(true);
  });
});
