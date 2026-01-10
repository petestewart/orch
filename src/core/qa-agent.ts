/**
 * QA Agent
 *
 * Specialized agent for automated quality assurance testing.
 * Spawns automatically when tickets enter QA status (if automation.qa.mode is "automatic").
 *
 * Implements: T027, T030
 */

import type { Ticket, QAResult, QADecision, AutomationMode } from './types';
import { AgentManager, buildQAPrompt } from './agent-manager';
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
    // If manual mode, return null (human will test)
    if (options.automationMode === 'manual') {
      getEventBus().publish({
        type: 'log:entry',
        timestamp: new Date(),
        level: 'info',
        message: `QA for ticket ${options.ticket.id} requires manual testing`,
        ticketId: options.ticket.id,
      });
      return null;
    }

    // Check if we can spawn
    if (!this.agentManager.canSpawn()) {
      throw new Error('Cannot spawn QA agent: max concurrency reached');
    }

    // Spawn QA agent using the buildQAPrompt from agent-manager
    // The spawn method will use the ticket to build the appropriate prompt
    const agentId = await this.agentManager.spawn({
      ticketId: options.ticket.id,
      workingDirectory: options.worktreePath,
      agentType: 'QA',
      model: options.model,
      ticket: options.ticket,
      projectPath: options.worktreePath,
    });

    getEventBus().publish({
      type: 'log:entry',
      timestamp: new Date(),
      level: 'info',
      message: `Spawned QA agent ${agentId} for ticket ${options.ticket.id}`,
      agentId,
      ticketId: options.ticket.id,
    });

    return agentId;
  }

  /**
   * Parse QA agent output to get decision
   */
  parseQAOutput(output: string): QAResult | null {
    const parsed = parseQADecision(output);

    if (!parsed.decision) {
      return null;
    }

    return {
      decision: parsed.decision,
      testResults: parsed.testResults,
      bugReport: parsed.bugReport,
    };
  }

  /**
   * Handle QA completion
   */
  async handleQAComplete(
    agentId: string,
    ticket: Ticket,
    automationMode: AutomationMode
  ): Promise<QAResult> {
    // Get agent output
    const outputBuffer = this.agentManager.getOutput(agentId);
    const output = outputBuffer.map(o => o.content).join('');

    // Parse result
    const result = this.parseQAOutput(output);

    if (!result) {
      // No decision marker found - treat as failed
      return {
        decision: 'FAILED',
        bugReport: 'QA agent did not output a valid decision marker',
      };
    }

    // If approval mode, emit event for human to confirm
    if (automationMode === 'approval') {
      getEventBus().publish({
        type: 'log:entry',
        timestamp: new Date(),
        level: 'info',
        message: `QA result for ticket ${ticket.id} awaiting approval: ${result.decision}`,
        ticketId: ticket.id,
        data: { qaResult: result },
      });
    }

    return result;
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
 * Note: The main buildQAPrompt function is in agent-manager.ts
 * This is kept for backward compatibility with the template approach
 */
export function buildQAPromptFromTemplate(
  ticket: Ticket,
  workingDir: string
): string {
  // Format acceptance criteria as bullet points
  const acceptanceCriteria = ticket.acceptanceCriteria.length > 0
    ? ticket.acceptanceCriteria.map(c => `- ${c}`).join('\n')
    : '- No specific criteria defined';

  // Format validation steps as numbered list
  const validationSteps = ticket.validationSteps.length > 0
    ? ticket.validationSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '1. Verify basic functionality works as expected';

  // Build prompt from template
  return QA_PROMPT_TEMPLATE
    .replace('{{TICKET_ID}}', ticket.id)
    .replace('{{TITLE}}', ticket.title)
    .replace('{{DESCRIPTION}}', ticket.description || ticket.title)
    .replace('{{ACCEPTANCE_CRITERIA}}', acceptanceCriteria)
    .replace('{{VALIDATION_STEPS}}', validationSteps)
    .replace('{{WORKING_DIR}}', workingDir);
}

/**
 * Parse QA decision from output
 * Looks for PASSED or FAILED markers
 */
export function parseQADecision(output: string): {
  decision: QADecision | null;
  testResults?: { name: string; passed: boolean; notes?: string }[];
  bugReport?: string;
} {
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
    const bugReport = extractBugReport(content);

    return {
      decision: 'FAILED',
      bugReport,
      testResults: parseTestResults(content),
    };
  }

  return { decision: null };
}

/**
 * Parse test results from output
 * Looks for patterns like "- [Test name]: PASS/FAIL - [notes]"
 */
function parseTestResults(output: string): { name: string; passed: boolean; notes?: string }[] {
  const results: { name: string; passed: boolean; notes?: string }[] = [];

  // First, try to find the "Tests completed:" section
  const testsCompletedMatch = output.match(/Tests completed:\s*([\s\S]*?)(?=\n\n|Summary:|$)/i);
  const searchText = testsCompletedMatch ? testsCompletedMatch[1] : output;

  // Pattern 1: "- [Test name]: PASS/FAIL - [notes]"
  const pattern1 = /-\s*\[?([^\]:\n]+?)\]?:\s*(PASS|FAIL)\s*(?:-\s*(.+?))?(?=\n|$)/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern1.exec(searchText)) !== null) {
    const name = match[1].trim();
    const passed = match[2].toUpperCase() === 'PASS';
    const notes = match[3]?.trim() || undefined;

    // Avoid duplicates
    if (!results.some(r => r.name === name)) {
      results.push({ name, passed, notes });
    }
  }

  // Pattern 2: "Test name: PASS" (simpler format)
  if (results.length === 0) {
    const pattern2 = /([A-Za-z][A-Za-z0-9\s]+?):\s*(PASS|FAIL)/gi;
    while ((match = pattern2.exec(searchText)) !== null) {
      const name = match[1].trim();
      const passed = match[2].toUpperCase() === 'PASS';

      // Avoid duplicates and filter out likely non-test entries
      if (!results.some(r => r.name === name) && name.length < 100) {
        results.push({ name, passed });
      }
    }
  }

  return results;
}

/**
 * Extract bug report from QA failure output
 * Looks for structured bug report format
 */
function extractBugReport(output: string): string | undefined {
  // Try to extract structured bug report section
  const bugReportMatch = output.match(/Bug Report:\s*([\s\S]*?)(?=Tests completed:|$)/i);
  if (bugReportMatch) {
    const report = bugReportMatch[1].trim();
    return report.length > 0 ? report : undefined;
  }

  // Try to extract from **Issue** markdown format
  const issueMatch = output.match(/\*\*Issue\*\*:\s*(.+?)(?=\n|$)/i);
  if (issueMatch) {
    let report = `Issue: ${issueMatch[1].trim()}`;

    // Try to get severity
    const severityMatch = output.match(/\*\*Severity\*\*:\s*(.+?)(?=\n|$)/i);
    if (severityMatch) {
      report += `\nSeverity: ${severityMatch[1].trim()}`;
    }

    // Try to get steps to reproduce
    const stepsMatch = output.match(/\*\*Steps to reproduce\*\*:\s*([\s\S]*?)(?=\*\*Expected|$)/i);
    if (stepsMatch) {
      report += `\nSteps to reproduce: ${stepsMatch[1].trim()}`;
    }

    // Try to get expected/actual
    const expectedMatch = output.match(/\*\*Expected\*\*:\s*(.+?)(?=\n|$)/i);
    const actualMatch = output.match(/\*\*Actual\*\*:\s*(.+?)(?=\n|$)/i);
    if (expectedMatch) {
      report += `\nExpected: ${expectedMatch[1].trim()}`;
    }
    if (actualMatch) {
      report += `\nActual: ${actualMatch[1].trim()}`;
    }

    return report;
  }

  return undefined;
}
