/**
 * Ticket Status Pipeline
 *
 * Manages ticket status transitions and enforces valid state machine rules.
 *
 * Status Flow:
 *   Todo -> InProgress -> Review -> QA -> Done
 *                ^         |      |
 *                |         v      v
 *                +-------- + -----+  (rejection sends back to Todo)
 *
 *   Failed -> Todo (retry)
 *
 * Implements: T028
 */

import type { TicketStatus, AutomationConfig } from './types';

/**
 * Status order for the normal pipeline flow
 * Index represents position in the pipeline
 */
const STATUS_ORDER: TicketStatus[] = ['Todo', 'InProgress', 'Review', 'QA', 'Done'];

/**
 * Valid transitions map
 * Key: current status, Value: array of valid next statuses
 */
const VALID_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  Todo: ['InProgress'],
  InProgress: ['Review', 'QA', 'Done', 'Failed'], // Can skip Review/QA based on config
  Review: ['QA', 'Done', 'Todo'], // Can skip QA, or reject back to Todo
  QA: ['Done', 'Todo'], // Can complete or reject back to Todo
  Done: [], // Terminal state - no further transitions
  Failed: ['Todo'], // Can retry, which resets to Todo
};

/**
 * Status descriptions for display
 */
export const STATUS_DESCRIPTIONS: Record<TicketStatus, string> = {
  Todo: 'Waiting to be started',
  InProgress: 'Being worked on by an agent',
  Review: 'Waiting for code review',
  QA: 'Waiting for QA testing',
  Done: 'Completed successfully',
  Failed: 'Failed - can be retried',
};

/**
 * Check if a status transition is valid
 *
 * @param from - Current status
 * @param to - Target status
 * @returns true if transition is valid
 */
export function isValidTransition(from: TicketStatus, to: TicketStatus): boolean {
  const validTargets = VALID_TRANSITIONS[from];
  return validTargets.includes(to);
}

/**
 * Get the next status in the pipeline for forward progression
 *
 * @param current - Current status
 * @param config - Optional automation config to determine skipping
 * @returns Next status or null if no forward progression available
 */
export function getNextStatus(
  current: TicketStatus,
  config?: AutomationConfig
): TicketStatus | null {
  const currentIndex = STATUS_ORDER.indexOf(current);

  // Failed status can only go to Todo (retry)
  if (current === 'Failed') {
    return 'Todo';
  }

  // Done has no next status
  if (current === 'Done' || currentIndex === -1) {
    return null;
  }

  // Determine next status based on config
  if (current === 'InProgress') {
    // Check if we should go to Review or skip
    if (config?.review.mode !== 'manual') {
      return 'Review';
    }
    if (config?.qa.mode !== 'manual') {
      return 'QA';
    }
    return 'Done';
  }

  if (current === 'Review') {
    // Check if we should go to QA or skip
    if (config?.qa.mode !== 'manual') {
      return 'QA';
    }
    return 'Done';
  }

  // Default: next in sequence
  return STATUS_ORDER[currentIndex + 1] ?? null;
}

/**
 * Get the previous status (for rejection flow)
 * Rejection always goes back to Todo for rework
 *
 * @param current - Current status
 * @returns Previous status for rejection, or null if cannot reject
 */
export function getPreviousStatus(current: TicketStatus): TicketStatus | null {
  // Only Review and QA can reject back
  if (current === 'Review' || current === 'QA') {
    return 'Todo';
  }

  // Failed can retry to Todo
  if (current === 'Failed') {
    return 'Todo';
  }

  return null;
}

/**
 * Check if a status can be advanced (moved forward in pipeline)
 *
 * @param status - Current status
 * @returns true if status can be advanced
 */
export function canAdvance(status: TicketStatus): boolean {
  return status !== 'Done' && status !== 'Failed' && status !== 'Todo';
}

/**
 * Check if a status can be rejected (moved back to Todo)
 *
 * @param status - Current status
 * @returns true if status can be rejected
 */
export function canReject(status: TicketStatus): boolean {
  return status === 'Review' || status === 'QA';
}

/**
 * Check if a status can be retried (reset from Failed to Todo)
 *
 * @param status - Current status
 * @returns true if status can be retried
 */
export function canRetry(status: TicketStatus): boolean {
  return status === 'Failed';
}

/**
 * Check if a status is a terminal state (no further transitions except retry)
 *
 * @param status - Current status
 * @returns true if status is terminal
 */
export function isTerminalStatus(status: TicketStatus): boolean {
  return status === 'Done' || status === 'Failed';
}

/**
 * Check if a status is actionable (can be worked on by an agent)
 *
 * @param status - Current status
 * @returns true if status is actionable
 */
export function isActionableStatus(status: TicketStatus): boolean {
  return status === 'Todo';
}

/**
 * Check if a status is in progress (actively being worked on)
 *
 * @param status - Current status
 * @returns true if ticket is being worked on
 */
export function isInProgressStatus(status: TicketStatus): boolean {
  return status === 'InProgress' || status === 'Review' || status === 'QA';
}

/**
 * Get all valid target statuses from a given status
 *
 * @param from - Current status
 * @returns Array of valid target statuses
 */
export function getValidTargetStatuses(from: TicketStatus): TicketStatus[] {
  return [...VALID_TRANSITIONS[from]];
}

/**
 * Validate a transition and throw if invalid
 *
 * @param from - Current status
 * @param to - Target status
 * @param ticketId - Optional ticket ID for error message
 * @throws Error if transition is invalid
 */
export function assertValidTransition(
  from: TicketStatus,
  to: TicketStatus,
  ticketId?: string
): void {
  if (!isValidTransition(from, to)) {
    const ticketInfo = ticketId ? ` for ticket ${ticketId}` : '';
    const validTargets = getValidTargetStatuses(from);
    const validTargetsStr = validTargets.length > 0 ? validTargets.join(', ') : 'none';
    throw new Error(
      `Invalid status transition${ticketInfo}: ${from} -> ${to}. Valid transitions from ${from}: ${validTargetsStr}`
    );
  }
}

/**
 * Get the display order of a status (for sorting)
 * Lower numbers appear first
 *
 * @param status - Status to get order for
 * @returns Numeric order value
 */
export function getStatusOrder(status: TicketStatus): number {
  if (status === 'Failed') {
    return -1; // Failed appears first (needs attention)
  }
  const index = STATUS_ORDER.indexOf(status);
  return index >= 0 ? index : 999;
}

/**
 * Sort statuses by pipeline order
 *
 * @param statuses - Array of statuses to sort
 * @returns Sorted array (Failed first, then pipeline order)
 */
export function sortStatusesByOrder(statuses: TicketStatus[]): TicketStatus[] {
  return [...statuses].sort((a, b) => getStatusOrder(a) - getStatusOrder(b));
}

/**
 * Transition result with optional feedback
 */
export interface TransitionResult {
  success: boolean;
  from: TicketStatus;
  to: TicketStatus;
  error?: string;
}

/**
 * Attempt a status transition and return result
 *
 * @param from - Current status
 * @param to - Target status
 * @returns TransitionResult indicating success or failure
 */
export function attemptTransition(from: TicketStatus, to: TicketStatus): TransitionResult {
  if (isValidTransition(from, to)) {
    return { success: true, from, to };
  }

  const validTargets = getValidTargetStatuses(from);
  const validTargetsStr = validTargets.length > 0 ? validTargets.join(', ') : 'none';

  return {
    success: false,
    from,
    to,
    error: `Cannot transition from ${from} to ${to}. Valid transitions: ${validTargetsStr}`,
  };
}

/**
 * Get status for keyboard shortcut display
 * 'a' advances, 'r' rejects
 *
 * @param status - Current status
 * @returns Object describing available actions
 */
export function getStatusActions(status: TicketStatus): {
  canApprove: boolean;
  canReject: boolean;
  approveTarget: TicketStatus | null;
  rejectTarget: TicketStatus | null;
} {
  return {
    canApprove: canAdvance(status),
    canReject: canReject(status),
    approveTarget: canAdvance(status) ? getNextStatus(status) : null,
    rejectTarget: canReject(status) ? getPreviousStatus(status) : null,
  };
}
