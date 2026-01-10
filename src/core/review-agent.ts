/**
 * Review Agent
 *
 * Performs automated code review when tickets enter the Review lane.
 * Spawns automatically based on automation.review.mode configuration.
 *
 * Implements: T026
 */

import type {
  Ticket,
  ReviewResult,
  ReviewDecision,
  OrchConfig,
  Agent,
  AgentType,
  AutomationMode,
} from './types';
import { getEventBus } from './events';
import { buildReviewPrompt } from './agent-manager';
import { getTicketDiff } from './epic-manager';
import type { Subprocess } from 'bun';

export interface ReviewAgentOptions {
  config: OrchConfig;
  projectRoot: string;
}

export interface ReviewOptions {
  ticket: Ticket;
  worktreePath: string;
  model?: string;
  automationMode: AutomationMode;
}

// Counter for unique review agent IDs
let reviewAgentIdCounter = 0;

/**
 * ReviewAgent class
 *
 * Manages review agent lifecycle and handles review decisions.
 */
export class ReviewAgent {
  private config: OrchConfig;
  private projectRoot: string;
  private activeAgents: Map<string, Agent> = new Map();
  private processes: Map<string, Subprocess> = new Map();
  private outputBuffers: Map<string, string> = new Map();

  constructor(options: ReviewAgentOptions) {
    this.config = options.config;
    this.projectRoot = options.projectRoot;
  }

  /**
   * Check if review should be spawned automatically based on config
   */
  shouldAutoSpawn(): boolean {
    return this.config.automation.review.mode === 'automatic';
  }

  /**
   * Check if review requires approval before executing decision
   */
  requiresApproval(): boolean {
    return this.config.automation.review.mode === 'approval';
  }

  /**
   * Check if review is manual (no automatic review agent)
   */
  isManual(): boolean {
    return this.config.automation.review.mode === 'manual';
  }

  /**
   * Start a review for a ticket
   * Returns agent ID if spawned, null if manual mode
   */
  async startReview(options: ReviewOptions): Promise<string | null> {
    // If manual mode, return null (human will review)
    if (options.automationMode === 'manual') {
      return null;
    }

    // Spawn review agent
    return this.spawnReviewAgent(options.ticket, options.worktreePath);
  }

  /**
   * Spawn a review agent for a ticket
   *
   * @param ticket - The ticket to review
   * @param workingDir - The working directory (worktree or project root)
   * @returns The agent ID
   */
  async spawnReviewAgent(ticket: Ticket, workingDir: string): Promise<string> {
    // Generate unique agent ID
    reviewAgentIdCounter++;
    const agentId = `review-agent-${reviewAgentIdCounter}`;

    // Get the git diff for the ticket's changes
    const gitDiff = await getTicketDiff(workingDir);

    // Build the review prompt using the existing function
    const prompt = buildReviewPrompt(ticket, gitDiff, workingDir);

    // Create agent record
    const agent: Agent = {
      id: agentId,
      type: 'Review' as AgentType,
      status: 'Starting',
      ticketId: ticket.id,
      workingDirectory: workingDir,
      startedAt: new Date(),
      tokensUsed: 0,
      cost: 0,
      progress: 0,
    };

    // Store agent record and output buffer
    this.activeAgents.set(agentId, agent);
    this.outputBuffers.set(agentId, '');

    // Build command args
    const model = this.config.automation.review.model || this.config.agentModel;
    const args = [
      'claude',
      '--print',
      '--dangerously-skip-permissions',
      '-p',
      prompt,
    ];

    // Add model if specified and not default
    if (model && model !== 'sonnet') {
      args.push('--model', model);
    }

    try {
      // Spawn the subprocess using Bun.spawn
      const proc = Bun.spawn(args, {
        cwd: workingDir,
        stdout: 'pipe',
        stderr: 'pipe',
        env: process.env,
      });

      // Store the process and update agent with PID
      this.processes.set(agentId, proc);
      agent.pid = proc.pid;
      agent.status = 'Working';

      // Set up stdout streaming
      this.streamOutput(agentId, proc.stdout, 'stdout');

      // Set up stderr streaming
      this.streamOutput(agentId, proc.stderr, 'stderr');

      // Handle process exit
      proc.exited.then((exitCode) => {
        this.handleProcessExit(agentId, exitCode, ticket.id);
      });

      // Emit agent:spawned event
      getEventBus().publish({
        type: 'agent:spawned',
        timestamp: new Date(),
        agentId,
        ticketId: ticket.id,
      });

      return agentId;
    } catch (error) {
      // Clean up on spawn failure
      this.activeAgents.delete(agentId);
      this.outputBuffers.delete(agentId);
      throw error;
    }
  }

  /**
   * Stream output from a readable stream to the output buffer
   */
  private async streamOutput(
    agentId: string,
    stream: ReadableStream<Uint8Array> | null,
    _type: 'stdout' | 'stderr'
  ): Promise<void> {
    if (!stream) return;

    const reader = stream.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const content = decoder.decode(value, { stream: true });

        // Append to buffer
        const currentBuffer = this.outputBuffers.get(agentId) || '';
        this.outputBuffers.set(agentId, currentBuffer + content);

        // Update agent last action
        const agent = this.activeAgents.get(agentId);
        if (agent) {
          agent.lastAction = content.slice(0, 100);
        }
      }
    } catch {
      // Stream closed or errored - this is normal when process exits
    }
  }

  /**
   * Handle process exit
   */
  private handleProcessExit(agentId: string, exitCode: number, ticketId: string): void {
    const agent = this.activeAgents.get(agentId);
    if (!agent) return;

    // Clean up process reference
    this.processes.delete(agentId);

    // Parse the output for review decision
    const output = this.outputBuffers.get(agentId) || '';
    const reviewResult = parseReviewDecision(output);

    if (exitCode === 0 && reviewResult.decision) {
      agent.status = 'Complete';
      agent.progress = 100;

      // Emit completion event with review decision
      getEventBus().publish({
        type: 'agent:completed',
        timestamp: new Date(),
        agentId,
        ticketId,
      });

      // Publish a log entry with the review result
      getEventBus().publish({
        type: 'log:entry',
        timestamp: new Date(),
        level: 'info',
        message: `Review completed for ${ticketId}: ${reviewResult.decision}`,
        agentId,
        ticketId,
        data: { reviewResult },
      });
    } else if (exitCode !== 0) {
      agent.status = 'Failed';
      getEventBus().publish({
        type: 'agent:failed',
        timestamp: new Date(),
        agentId,
        ticketId,
        error: `Review agent process exited with code ${exitCode}`,
      });
    } else {
      // Process exited 0 but no clear decision - treat as requiring manual review
      agent.status = 'Complete';
      getEventBus().publish({
        type: 'agent:completed',
        timestamp: new Date(),
        agentId,
        ticketId,
      });

      getEventBus().publish({
        type: 'log:entry',
        timestamp: new Date(),
        level: 'warn',
        message: `Review for ${ticketId} completed but decision unclear - may require manual review`,
        agentId,
        ticketId,
      });
    }
  }

  /**
   * Handle review completion
   */
  async handleReviewComplete(
    agentId: string,
    ticket: Ticket,
    automationMode: AutomationMode
  ): Promise<ReviewResult> {
    const output = this.outputBuffers.get(agentId) || '';
    const result = parseReviewDecision(output);

    if (!result.decision) {
      // No clear decision - return as needing changes with feedback
      return {
        decision: 'CHANGES_REQUESTED',
        feedback: 'Review agent did not produce a clear decision. Manual review required.',
      };
    }

    // Build the review result
    const reviewResult: ReviewResult = {
      decision: result.decision,
      feedback: result.feedback,
    };

    // If in approval mode, log that human confirmation is needed
    if (automationMode === 'approval') {
      getEventBus().publish({
        type: 'log:entry',
        timestamp: new Date(),
        level: 'info',
        message: `Review decision for ${ticket.id} awaiting human approval: ${result.decision}`,
        agentId,
        ticketId: ticket.id,
        data: { reviewResult },
      });
    }

    return reviewResult;
  }

  /**
   * Parse review agent output to get decision
   */
  parseReviewOutput(output: string): ReviewResult | null {
    const result = parseReviewDecision(output);
    if (!result.decision) return null;

    return {
      decision: result.decision,
      feedback: result.feedback,
    };
  }

  /**
   * Stop a review agent gracefully
   */
  async stop(agentId: string): Promise<void> {
    const agent = this.activeAgents.get(agentId);
    const proc = this.processes.get(agentId);

    if (!agent) {
      throw new Error(`Review agent not found: ${agentId}`);
    }

    if (!proc) {
      // Process already exited or never started
      agent.status = 'Failed';
      return;
    }

    // Send SIGTERM
    proc.kill('SIGTERM');

    // Wait up to 5 seconds for graceful exit
    const timeout = 5000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (!this.processes.has(agentId)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // If still running, send SIGKILL
    if (this.processes.has(agentId)) {
      proc.kill('SIGKILL');
      this.processes.delete(agentId);
    }

    // Update agent status
    agent.status = 'Failed';

    // Emit agent:stopped event
    getEventBus().publish({
      type: 'agent:stopped',
      timestamp: new Date(),
      agentId,
      ticketId: agent.ticketId || '',
    });
  }

  /**
   * Stop all active review agents
   */
  async stopAll(): Promise<void> {
    const activeAgentIds = Array.from(this.activeAgents.entries())
      .filter(([_, agent]) => agent.status === 'Starting' || agent.status === 'Working')
      .map(([id]) => id);

    await Promise.all(activeAgentIds.map((id) => this.stop(id)));
  }

  /**
   * Get a review agent by ID
   */
  getAgent(agentId: string): Agent | undefined {
    return this.activeAgents.get(agentId);
  }

  /**
   * Get all review agents
   */
  getAllAgents(): Agent[] {
    return Array.from(this.activeAgents.values());
  }

  /**
   * Get the output for a review agent
   */
  getOutput(agentId: string): string {
    return this.outputBuffers.get(agentId) || '';
  }

  /**
   * Get the review result for a completed agent
   */
  getReviewResult(agentId: string): ReviewResult | null {
    const output = this.outputBuffers.get(agentId);
    if (!output) return null;

    const result = parseReviewDecision(output);
    if (!result.decision) return null;

    return {
      decision: result.decision,
      feedback: result.feedback,
    };
  }
}

// =============================================================================
// Review decision parsing
// =============================================================================

/**
 * Parse review decision from output
 *
 * Looks for:
 * - === REVIEW DECISION: APPROVED ===
 * - === REVIEW DECISION: CHANGES_REQUESTED ===
 *
 * Also extracts feedback if present.
 */
export function parseReviewDecision(output: string): {
  decision: ReviewDecision | null;
  feedback?: string;
} {
  // Use more flexible regex to handle extra whitespace
  const approvedMatch = output.match(/===\s*REVIEW\s+DECISION:\s*APPROVED\s*===/i);
  const changesMatch = output.match(/===\s*REVIEW\s+DECISION:\s*CHANGES_REQUESTED\s*===/i);

  if (approvedMatch) {
    const feedbackStart = approvedMatch.index! + approvedMatch[0].length;
    const feedback = extractFeedback(output.slice(feedbackStart));
    return {
      decision: 'APPROVED',
      feedback: feedback || undefined,
    };
  }

  if (changesMatch) {
    const feedbackStart = changesMatch.index! + changesMatch[0].length;
    const feedback = extractFeedback(output.slice(feedbackStart));
    return {
      decision: 'CHANGES_REQUESTED',
      feedback: feedback || undefined,
    };
  }

  return { decision: null };
}

/**
 * Extract feedback text from review output after the decision marker
 * Stops at any === marker or end of output
 */
function extractFeedback(text: string): string | null {
  const lines = text.split('\n');
  const feedbackLines: string[] = [];

  for (const line of lines) {
    // Stop at any marker pattern
    if (line.includes('===')) break;
    const trimmed = line.trim();
    if (trimmed) {
      feedbackLines.push(trimmed);
    }
  }

  return feedbackLines.length > 0 ? feedbackLines.join('\n') : null;
}

/**
 * Check if a review decision indicates approval
 */
export function isApproved(result: ReviewResult): boolean {
  return result.decision === 'APPROVED';
}

/**
 * Check if a review decision indicates changes are requested
 */
export function isChangesRequested(result: ReviewResult): boolean {
  return result.decision === 'CHANGES_REQUESTED';
}

/**
 * Format a review result as feedback text for the ticket
 */
export function formatReviewFeedback(result: ReviewResult): string {
  if (result.decision === 'APPROVED') {
    return result.feedback || 'Review approved';
  }

  const lines: string[] = ['Review requested changes:'];

  if (result.issues && result.issues.length > 0) {
    for (const issue of result.issues) {
      const location = issue.file
        ? issue.line
          ? `${issue.file}:${issue.line}`
          : issue.file
        : '';
      const prefix = location ? `[${location}] ` : '';
      lines.push(`- [${issue.severity}] ${prefix}${issue.message}`);
    }
  }

  if (result.feedback) {
    lines.push('', result.feedback);
  }

  return lines.join('\n');
}
