/**
 * Review Agent
 *
 * Specialized agent for automated code review.
 *
 * Implements: T026, T030
 */

import type { Ticket, ReviewResult, ReviewDecision, AutomationMode } from './types';
import { AgentManager, buildReviewPrompt } from './agent-manager';
import { getTicketDiff } from './epic-manager';
import { getEventBus } from './events';

export interface ReviewOptions {
  ticket: Ticket;
  worktreePath: string;
  model?: string;
  automationMode: AutomationMode;
}

export class ReviewAgent {
  private agentManager: AgentManager;

  constructor(agentManager: AgentManager) {
    this.agentManager = agentManager;
  }

  /**
   * Start a review for a ticket
   * Returns agent ID if spawned, null if manual mode
   */
  async startReview(options: ReviewOptions): Promise<string | null> {
    // TODO: Implement - T026
    // - If manual mode, return null (human will review)
    // - Get git diff for the ticket
    // - Build review prompt
    // - Spawn review agent
    // - Return agent ID
    throw new Error('Not implemented');
  }

  /**
   * Parse review agent output to get decision
   */
  parseReviewOutput(output: string): ReviewResult | null {
    // TODO: Implement - T026
    // - Look for APPROVED or CHANGES_REQUESTED marker
    // - Extract feedback/issues if present
    throw new Error('Not implemented');
  }

  /**
   * Handle review completion
   */
  async handleReviewComplete(
    agentId: string,
    ticket: Ticket,
    automationMode: AutomationMode
  ): Promise<ReviewResult> {
    // TODO: Implement - T026
    // - Get agent output
    // - Parse result
    // - If approval mode, emit event and wait for human
    // - If automatic mode, apply decision
    throw new Error('Not implemented');
  }
}

// =============================================================================
// Review prompt template - T030
// =============================================================================

export const REVIEW_PROMPT_TEMPLATE = `
You are a code reviewer. Review the following changes for ticket {{TICKET_ID}}: {{TITLE}}

## Ticket Context
{{DESCRIPTION}}

## Acceptance Criteria
{{ACCEPTANCE_CRITERIA}}

## Code Changes
\`\`\`diff
{{GIT_DIFF}}
\`\`\`

## Review Checklist
Please check for:
1. **Correctness**: Does the code meet the acceptance criteria?
2. **Code Quality**: Is the code clean, readable, and maintainable?
3. **Security**: Are there any security vulnerabilities?
4. **Performance**: Are there any performance concerns?
5. **Patterns**: Does the code follow existing patterns in the codebase?

## Output Format
After your review, output EXACTLY ONE of the following:

If approved:
=== REVIEW DECISION: APPROVED ===
[Brief summary of what looks good]

If changes needed:
=== REVIEW DECISION: CHANGES_REQUESTED ===
[List specific issues that need to be addressed]
- Issue 1: description
- Issue 2: description
`;

/**
 * Build a review prompt for a specific ticket
 */
export function buildReviewPromptFromTemplate(
  ticket: Ticket,
  gitDiff: string
): string {
  // TODO: Implement - T030
  // - Replace placeholders with actual values
  throw new Error('Not implemented');
}

/**
 * Parse review decision from output
 */
export function parseReviewDecision(output: string): {
  decision: ReviewDecision | null;
  feedback?: string;
} {
  // TODO: Implement - T026
  const approvedMatch = output.match(/=== REVIEW DECISION: APPROVED ===/i);
  const changesMatch = output.match(/=== REVIEW DECISION: CHANGES_REQUESTED ===/i);

  if (approvedMatch) {
    const feedbackStart = approvedMatch.index! + approvedMatch[0].length;
    return {
      decision: 'APPROVED',
      feedback: output.slice(feedbackStart).trim(),
    };
  }

  if (changesMatch) {
    const feedbackStart = changesMatch.index! + changesMatch[0].length;
    return {
      decision: 'CHANGES_REQUESTED',
      feedback: output.slice(feedbackStart).trim(),
    };
  }

  return { decision: null };
}
