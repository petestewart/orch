/**
 * QA Agent
 *
 * Specialized agent for automated quality assurance testing.
 *
 * Implements: T027, T030
 */

import type { Ticket, QAResult, QADecision, AutomationMode } from './types';
import { AgentManager } from './agent-manager';
import { getEventBus } from './events';

export interface QAOptions {
  ticket: Ticket;
  worktreePath: string;
  model?: string;
  automationMode: AutomationMode;
}

export class QAAgent {
  private agentManager: AgentManager;

  constructor(agentManager: AgentManager) {
    this.agentManager = agentManager;
  }

  /**
   * Start QA testing for a ticket
   * Returns agent ID if spawned, null if manual mode
   */
  async startQA(options: QAOptions): Promise<string | null> {
    // TODO: Implement - T027
    // - If manual mode, return null (human will test)
    // - Build QA prompt
    // - Spawn QA agent
    // - Return agent ID
    throw new Error('Not implemented');
  }

  /**
   * Parse QA agent output to get decision
   */
  parseQAOutput(output: string): QAResult | null {
    // TODO: Implement - T027
    // - Look for PASSED or FAILED marker
    // - Extract test results if present
    // - Extract bug report if failed
    throw new Error('Not implemented');
  }

  /**
   * Handle QA completion
   */
  async handleQAComplete(
    agentId: string,
    ticket: Ticket,
    automationMode: AutomationMode
  ): Promise<QAResult> {
    // TODO: Implement - T027
    // - Get agent output
    // - Parse result
    // - If approval mode, emit event and wait for human
    // - If automatic mode, apply decision
    throw new Error('Not implemented');
  }
}

// =============================================================================
// QA prompt template - T030
// =============================================================================

export const QA_PROMPT_TEMPLATE = `
You are a QA tester. Test the implementation of ticket {{TICKET_ID}}: {{TITLE}}

## Ticket Context
{{DESCRIPTION}}

## Acceptance Criteria
{{ACCEPTANCE_CRITERIA}}

## Validation Steps
{{VALIDATION_STEPS}}

## Working Directory
{{WORKING_DIR}}

## Your Task
1. Read and understand the acceptance criteria
2. Run the validation steps provided
3. Perform additional manual testing to verify functionality
4. Check edge cases and error handling
5. Verify the implementation matches the requirements

## Testing Guidelines
- Actually run the application/tests
- Try both happy path and error scenarios
- Check for edge cases
- Verify error messages are helpful
- Ensure the implementation is complete

## Output Format
After testing, output EXACTLY ONE of the following:

If all tests pass:
=== QA DECISION: PASSED ===
Tests completed:
- [Test 1]: PASS - [notes]
- [Test 2]: PASS - [notes]

If any tests fail:
=== QA DECISION: FAILED ===
Bug Report:
- **Issue**: [Description of the failure]
- **Steps to reproduce**: [How to reproduce]
- **Expected**: [What should happen]
- **Actual**: [What actually happened]

Tests completed:
- [Test 1]: PASS/FAIL - [notes]
- [Test 2]: PASS/FAIL - [notes]
`;

/**
 * Build a QA prompt for a specific ticket
 */
export function buildQAPromptFromTemplate(
  ticket: Ticket,
  workingDir: string
): string {
  // TODO: Implement - T030
  // - Replace placeholders with actual values
  throw new Error('Not implemented');
}

/**
 * Parse QA decision from output
 */
export function parseQADecision(output: string): {
  decision: QADecision | null;
  testResults?: { name: string; passed: boolean; notes?: string }[];
  bugReport?: string;
} {
  // TODO: Implement - T027
  const passedMatch = output.match(/=== QA DECISION: PASSED ===/i);
  const failedMatch = output.match(/=== QA DECISION: FAILED ===/i);

  if (passedMatch) {
    const resultsStart = passedMatch.index! + passedMatch[0].length;
    return {
      decision: 'PASSED',
      testResults: parseTestResults(output.slice(resultsStart)),
    };
  }

  if (failedMatch) {
    const resultsStart = failedMatch.index! + failedMatch[0].length;
    const content = output.slice(resultsStart);

    // Extract bug report
    const bugReportMatch = content.match(/Bug Report:([\s\S]*?)(?=Tests completed:|$)/i);

    return {
      decision: 'FAILED',
      bugReport: bugReportMatch ? bugReportMatch[1].trim() : undefined,
      testResults: parseTestResults(content),
    };
  }

  return { decision: null };
}

/**
 * Parse test results from output
 */
function parseTestResults(output: string): { name: string; passed: boolean; notes?: string }[] {
  // TODO: Implement - T027
  // - Parse lines like "- [Test name]: PASS/FAIL - [notes]"
  return [];
}
