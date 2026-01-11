/**
 * Agent Manager
 *
 * Manages agent lifecycle: spawning, monitoring, stopping.
 * Wraps Claude Code CLI subprocess.
 *
 * Implements: T005, T006, T007, T018 (Error Recovery)
 */

import type { Agent, AgentType, Ticket, ErrorRecoveryConfig } from './types';
import { getEventBus } from './events';
import type { Subprocess } from 'bun';
import {
  logAgentCrash,
  logMalformedOutput,
  logError,
  withRetry,
  DEFAULT_ERROR_RECOVERY_CONFIG,
  AgentCrashError,
  type RetryOptions,
} from './error-recovery';

export interface SpawnOptions {
  ticketId: string;
  workingDirectory: string;
  agentType?: AgentType;
  model?: string;
  ticket?: Ticket; // Full ticket data for prompt building
  projectPath?: string; // Project root path
  branch?: string; // Git branch name for commits (e.g., "ticket/T001")
  epicName?: string; // Epic name for context
  /** Error recovery configuration (optional) */
  errorRecovery?: Partial<ErrorRecoveryConfig>;
}

export interface AgentOutput {
  type: 'stdout' | 'stderr';
  content: string;
  timestamp: Date;
}

export interface AgentMetrics {
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  elapsedMs: number;
}

// Counter for unique agent IDs
let agentIdCounter = 0;

// Token pricing (per 1M tokens) - based on Claude Sonnet
const DEFAULT_INPUT_PRICE_PER_MILLION = 3.0;  // $3 per 1M input tokens
const DEFAULT_OUTPUT_PRICE_PER_MILLION = 15.0; // $15 per 1M output tokens

export class AgentManager {
  private agents: Map<string, Agent> = new Map();
  private processes: Map<string, Subprocess> = new Map();
  private outputBuffers: Map<string, AgentOutput[]> = new Map();
  private metricsMap: Map<string, AgentMetrics> = new Map();
  private retryCountMap: Map<string, number> = new Map(); // ticketId -> retry count
  private maxAgents: number;
  private defaultModel: string;
  private errorRecoveryConfig: ErrorRecoveryConfig;

  constructor(
    maxAgents = 5,
    defaultModel = 'sonnet',
    errorRecoveryConfig?: Partial<ErrorRecoveryConfig>
  ) {
    this.maxAgents = maxAgents;
    this.defaultModel = defaultModel;
    this.errorRecoveryConfig = {
      ...DEFAULT_ERROR_RECOVERY_CONFIG,
      ...errorRecoveryConfig,
    };
  }

  /**
   * Spawn a new agent for a ticket
   * Returns the agent ID
   */
  async spawn(options: SpawnOptions): Promise<string> {
    // Check concurrency limit
    if (!this.canSpawn()) {
      throw new Error(
        `Cannot spawn agent: concurrency limit reached (${this.maxAgents} max agents)`
      );
    }

    // Generate unique agent ID
    agentIdCounter++;
    const agentId = `agent-${agentIdCounter}`;

    // Build prompt - use provided ticket or create minimal prompt
    const prompt = options.ticket
      ? buildImplementationPrompt(
          options.ticket,
          options.projectPath || options.workingDirectory,
          options.workingDirectory,
          options.branch,
          options.epicName
        )
      : `You are working on ticket ${options.ticketId}. Working directory: ${options.workingDirectory}`;

    // Create agent record
    const agent: Agent = {
      id: agentId,
      type: options.agentType || 'Implementation',
      status: 'Starting',
      ticketId: options.ticketId,
      workingDirectory: options.workingDirectory,
      startedAt: new Date(),
      tokensUsed: 0,
      cost: 0,
      progress: 0,
    };

    // Store agent record, output buffer, and initialize metrics
    this.agents.set(agentId, agent);
    this.outputBuffers.set(agentId, []);
    this.metricsMap.set(agentId, {
      tokensUsed: 0,
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      elapsedMs: 0,
    });

    // Build command args
    const model = options.model || this.defaultModel;
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
        cwd: options.workingDirectory,
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
        this.handleProcessExit(agentId, exitCode);
      });

      // Emit agent:spawned event
      getEventBus().publish({
        type: 'agent:spawned',
        timestamp: new Date(),
        agentId,
        ticketId: options.ticketId,
      });

      return agentId;
    } catch (error) {
      // Clean up on spawn failure
      this.agents.delete(agentId);
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
    type: 'stdout' | 'stderr'
  ): Promise<void> {
    if (!stream) return;

    const reader = stream.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const content = decoder.decode(value, { stream: true });
        const output: AgentOutput = {
          type,
          content,
          timestamp: new Date(),
        };

        // Add to buffer
        const buffer = this.outputBuffers.get(agentId);
        if (buffer) {
          buffer.push(output);
        }

        // Parse token metrics from output
        this.updateMetricsFromOutput(agentId, content);

        // Emit progress event
        const agent = this.agents.get(agentId);
        const metrics = this.metricsMap.get(agentId);
        if (agent) {
          agent.lastAction = content.slice(0, 100); // Store first 100 chars as last action
          getEventBus().publish({
            type: 'agent:progress',
            timestamp: new Date(),
            agentId,
            ticketId: agent.ticketId || '',
            progress: agent.progress,
            lastAction: agent.lastAction,
            tokensUsed: agent.tokensUsed,
            inputTokens: metrics?.inputTokens || 0,
            outputTokens: metrics?.outputTokens || 0,
            cost: agent.cost,
          });
        }
      }
    } catch {
      // Stream closed or errored - this is normal when process exits
    }
  }

  /**
   * Update agent metrics from parsed output
   * Looks for token usage patterns in Claude Code output
   */
  private updateMetricsFromOutput(agentId: string, content: string): void {
    const agent = this.agents.get(agentId);
    const metrics = this.metricsMap.get(agentId);
    if (!agent || !metrics) return;

    // Parse token usage from output
    const tokenInfo = parseTokenUsage(content);
    if (tokenInfo) {
      metrics.inputTokens += tokenInfo.inputTokens;
      metrics.outputTokens += tokenInfo.outputTokens;
      metrics.tokensUsed = metrics.inputTokens + metrics.outputTokens;

      // Calculate cost
      metrics.cost = calculateCost(metrics.inputTokens, metrics.outputTokens);

      // Update agent record
      agent.tokensUsed = metrics.tokensUsed;
      agent.cost = metrics.cost;
    }

    // Update elapsed time
    if (agent.startedAt) {
      metrics.elapsedMs = Date.now() - agent.startedAt.getTime();
    }
  }

  /**
   * Handle process exit
   * T018: Enhanced with crash logging and error context
   */
  private handleProcessExit(agentId: string, exitCode: number): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // Clean up process reference
    this.processes.delete(agentId);

    // Check output for completion/blocked markers
    const output = this.getOutputAsString(agentId);
    const complete = isComplete(output);
    const blocked = isBlocked(output);

    if (exitCode === 0 && complete) {
      agent.status = 'Complete';
      agent.progress = 100;
      getEventBus().publish({
        type: 'agent:completed',
        timestamp: new Date(),
        agentId,
        ticketId: agent.ticketId || '',
      });
    } else if (blocked.blocked) {
      agent.status = 'Blocked';
      getEventBus().publish({
        type: 'agent:blocked',
        timestamp: new Date(),
        agentId,
        ticketId: agent.ticketId || '',
        reason: blocked.reason,
      });
    } else if (exitCode !== 0) {
      // T018: Agent crash - log error with full context
      agent.status = 'Failed';
      const errorMessage = `Process exited with code ${exitCode}`;

      // Log the crash with context for debugging
      logAgentCrash(
        agentId,
        agent.ticketId,
        new AgentCrashError(errorMessage, agentId, agent.ticketId, exitCode),
        exitCode
      );

      // Track retry count for this ticket
      if (agent.ticketId) {
        const currentRetries = this.retryCountMap.get(agent.ticketId) || 0;
        this.retryCountMap.set(agent.ticketId, currentRetries + 1);
      }

      getEventBus().publish({
        type: 'agent:failed',
        timestamp: new Date(),
        agentId,
        ticketId: agent.ticketId || '',
        error: errorMessage,
      });
    } else {
      // Exited 0 but no completion marker
      // T018: Log warning for malformed output but continue processing
      if (output.length > 0) {
        logMalformedOutput(
          agentId,
          output,
          'Agent exited cleanly but no completion marker found'
        );
      }
      // Still treat as complete since exit code was 0
      agent.status = 'Complete';
      agent.progress = 100;
      getEventBus().publish({
        type: 'agent:completed',
        timestamp: new Date(),
        agentId,
        ticketId: agent.ticketId || '',
      });
    }
  }

  /**
   * Get output buffer as a single string
   */
  private getOutputAsString(agentId: string): string {
    const buffer = this.outputBuffers.get(agentId);
    if (!buffer) return '';
    return buffer.map((o) => o.content).join('');
  }

  /**
   * Stop an agent gracefully
   * Sends SIGTERM, waits, then SIGKILL if needed
   */
  async stop(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    const proc = this.processes.get(agentId);

    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
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
      // Check if process has exited
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
   * Stop all running agents
   * Stops only agents that are currently active (Starting or Working status)
   */
  async stopAll(): Promise<void> {
    const activeAgentIds = Array.from(this.agents.entries())
      .filter(([_, agent]) => agent.status === 'Starting' || agent.status === 'Working')
      .map(([id]) => id);
    await Promise.all(activeAgentIds.map(id => this.stop(id)));
  }

  /**
   * Get an agent by ID
   */
  getAgent(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all agents
   */
  getAllAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get running agents count
   */
  getActiveCount(): number {
    return Array.from(this.agents.values())
      .filter(a => a.status === 'Working' || a.status === 'Starting')
      .length;
  }

  /**
   * Check if we can spawn more agents
   */
  canSpawn(): boolean {
    return this.getActiveCount() < this.maxAgents;
  }

  /**
   * Get output buffer for an agent
   */
  getOutput(agentId: string): AgentOutput[] {
    return this.outputBuffers.get(agentId) || [];
  }

  /**
   * Update max agents limit
   */
  setMaxAgents(max: number): void {
    this.maxAgents = max;
  }

  /**
   * Get max agents limit
   */
  getMaxAgents(): number {
    return this.maxAgents;
  }

  /**
   * Get metrics for an agent
   */
  getMetrics(agentId: string): AgentMetrics | undefined {
    return this.metricsMap.get(agentId);
  }

  /**
   * Get aggregated metrics for all agents
   */
  getTotalMetrics(): AgentMetrics {
    const total: AgentMetrics = {
      tokensUsed: 0,
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      elapsedMs: 0,
    };

    for (const metrics of this.metricsMap.values()) {
      total.tokensUsed += metrics.tokensUsed;
      total.inputTokens += metrics.inputTokens;
      total.outputTokens += metrics.outputTokens;
      total.cost += metrics.cost;
      // For elapsed, we take the max (longest running agent)
      total.elapsedMs = Math.max(total.elapsedMs, metrics.elapsedMs);
    }

    return total;
  }

  // ===========================================================================
  // T018: Error Recovery Methods
  // ===========================================================================

  /**
   * Get the number of retry attempts for a ticket
   */
  getRetryCount(ticketId: string): number {
    return this.retryCountMap.get(ticketId) || 0;
  }

  /**
   * Check if a ticket can be retried (hasn't exceeded max retries)
   */
  canRetry(ticketId: string): boolean {
    const retryCount = this.getRetryCount(ticketId);
    return retryCount < this.errorRecoveryConfig.maxRetries;
  }

  /**
   * Reset retry count for a ticket (call after successful completion)
   */
  resetRetryCount(ticketId: string): void {
    this.retryCountMap.delete(ticketId);
  }

  /**
   * Get the error recovery configuration
   */
  getErrorRecoveryConfig(): ErrorRecoveryConfig {
    return { ...this.errorRecoveryConfig };
  }

  /**
   * Update error recovery configuration
   */
  setErrorRecoveryConfig(config: Partial<ErrorRecoveryConfig>): void {
    this.errorRecoveryConfig = {
      ...this.errorRecoveryConfig,
      ...config,
    };
  }

  // ===========================================================================
  // T036: Refine Agent Methods
  // ===========================================================================

  /**
   * Spawn a Refine Agent for AI-assisted ticket creation/refinement
   *
   * Unlike regular spawn(), this creates an interactive agent that:
   * - Has context of the current PLAN.md and epic structure
   * - Can read the codebase to understand context
   * - Uses a specialized prompt for ticket creation
   * - Streams responses in real-time via the event bus
   *
   * @returns RefineAgentResult with agent ID, output promise, and stop function
   */
  async spawnRefineAgent(options: RefineAgentOptions): Promise<RefineAgentResult> {
    // Generate unique agent ID
    agentIdCounter++;
    const agentId = `refine-agent-${agentIdCounter}`;

    // Build the specialized refine prompt
    const prompt = buildRefinePrompt(
      options.planContent,
      options.existingTicketIds,
      options.epics,
      options.workingDirectory,
      options.userMessage
    );

    // Create agent record
    const agent: Agent = {
      id: agentId,
      type: 'Refine',
      status: 'Starting',
      ticketId: undefined, // Refine agents don't work on a specific ticket
      workingDirectory: options.workingDirectory,
      startedAt: new Date(),
      tokensUsed: 0,
      cost: 0,
      progress: 0,
    };

    // Store agent record, output buffer, and initialize metrics
    this.agents.set(agentId, agent);
    this.outputBuffers.set(agentId, []);
    this.metricsMap.set(agentId, {
      tokensUsed: 0,
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      elapsedMs: 0,
    });

    // Build command args
    const model = options.model || this.defaultModel;
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

    // Create promise that resolves when agent completes
    let resolveOutput: (value: string) => void;
    let rejectOutput: (error: Error) => void;
    const outputPromise = new Promise<string>((resolve, reject) => {
      resolveOutput = resolve;
      rejectOutput = reject;
    });

    try {
      // Spawn the subprocess using Bun.spawn
      const proc = Bun.spawn(args, {
        cwd: options.workingDirectory,
        stdout: 'pipe',
        stderr: 'pipe',
        env: process.env,
      });

      // Store the process and update agent with PID
      this.processes.set(agentId, proc);
      agent.pid = proc.pid;
      agent.status = 'Working';

      // Set up stdout streaming with real-time events
      this.streamRefineOutput(agentId, proc.stdout, 'stdout');

      // Set up stderr streaming
      this.streamOutput(agentId, proc.stderr, 'stderr');

      // Handle process exit
      proc.exited.then((exitCode) => {
        const output = this.getOutputAsString(agentId);
        this.handleRefineProcessExit(agentId, exitCode);

        if (exitCode === 0) {
          resolveOutput(output);
        } else {
          rejectOutput(new Error(`Refine agent exited with code ${exitCode}`));
        }
      });

      // Emit agent:spawned event
      getEventBus().publish({
        type: 'agent:spawned',
        timestamp: new Date(),
        agentId,
        ticketId: '',
      });

      // Return result with control methods
      return {
        agentId,
        output: outputPromise,
        stop: async () => {
          await this.stop(agentId);
          rejectOutput(new Error('Agent stopped by user'));
        },
      };
    } catch (error) {
      // Clean up on spawn failure
      this.agents.delete(agentId);
      this.outputBuffers.delete(agentId);
      this.metricsMap.delete(agentId);
      throw error;
    }
  }

  /**
   * Stream output from Refine agent with real-time progress events
   * Emits agent:progress events for each chunk so UI can display streaming responses
   */
  private async streamRefineOutput(
    agentId: string,
    stream: ReadableStream<Uint8Array> | null,
    type: 'stdout' | 'stderr'
  ): Promise<void> {
    if (!stream) return;

    const reader = stream.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const content = decoder.decode(value, { stream: true });
        const output: AgentOutput = {
          type,
          content,
          timestamp: new Date(),
        };

        // Add to buffer
        const buffer = this.outputBuffers.get(agentId);
        if (buffer) {
          buffer.push(output);
        }

        // Parse token metrics from output
        this.updateMetricsFromOutput(agentId, content);

        // Emit progress event with the new content chunk
        // This allows the UI to display streaming responses in real-time
        const agent = this.agents.get(agentId);
        const metrics = this.metricsMap.get(agentId);
        if (agent) {
          agent.lastAction = content;
          getEventBus().publish({
            type: 'agent:progress',
            timestamp: new Date(),
            agentId,
            ticketId: '',
            progress: agent.progress,
            lastAction: content, // Full chunk for streaming display
            tokensUsed: agent.tokensUsed,
            inputTokens: metrics?.inputTokens || 0,
            outputTokens: metrics?.outputTokens || 0,
            cost: agent.cost,
          });
        }
      }
    } catch {
      // Stream closed or errored - this is normal when process exits
    }
  }

  /**
   * Handle Refine agent process exit
   */
  private handleRefineProcessExit(agentId: string, exitCode: number): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // Clean up process reference
    this.processes.delete(agentId);

    if (exitCode === 0) {
      agent.status = 'Complete';
      agent.progress = 100;
      getEventBus().publish({
        type: 'agent:completed',
        timestamp: new Date(),
        agentId,
        ticketId: '',
      });
    } else {
      agent.status = 'Failed';
      const errorMessage = `Refine agent exited with code ${exitCode}`;
      getEventBus().publish({
        type: 'agent:failed',
        timestamp: new Date(),
        agentId,
        ticketId: '',
        error: errorMessage,
      });
    }
  }

  /**
   * Send a follow-up message to an existing Refine agent
   * This is used for multi-turn conversations
   *
   * Note: Claude CLI --print mode doesn't support multi-turn conversations directly.
   * For a true multi-turn experience, we spawn a new agent with conversation history.
   */
  async sendRefineMessage(
    previousOutput: string,
    userMessage: string,
    options: Omit<RefineAgentOptions, 'userMessage'>
  ): Promise<RefineAgentResult> {
    // Build a prompt that includes the previous conversation
    const conversationPrompt = `${buildRefinePrompt(
      options.planContent,
      options.existingTicketIds,
      options.epics,
      options.workingDirectory
    )}

## Previous Conversation
${previousOutput}

## User's Follow-up
${userMessage}

Please continue helping the user based on the conversation above.`;

    // Spawn a new agent with the conversation context
    return this.spawnRefineAgent({
      ...options,
      userMessage: conversationPrompt,
    });
  }
}

// =============================================================================
// Output parsing - T006
// =============================================================================

export interface ParsedOutput {
  isComplete: boolean;
  isBlocked: boolean;
  blockReason?: string;
  toolCalls: {
    tool: string;
    args?: Record<string, unknown>;
  }[];
  progress: number; // Estimated 0-100
}

/**
 * Parse agent output to detect completion, blockers, progress
 * Handles streaming output with partial lines
 */
export function parseAgentOutput(output: string): ParsedOutput {
  // Use existing helpers for completion/blocked detection
  const complete = isComplete(output);
  const blocked = isBlocked(output);

  // Extract tool calls
  const toolCalls = extractToolCalls(output);

  // Estimate progress
  const progress = estimateProgress(output, toolCalls, complete, blocked.blocked);

  return {
    isComplete: complete,
    isBlocked: blocked.blocked,
    blockReason: blocked.reason,
    toolCalls,
    progress,
  };
}

/**
 * Extract tool calls from Claude Code output
 * Handles various output formats including:
 * - "Using Read tool to read file.ts"
 * - "Using Write tool to write file.ts"
 * - "Using Bash tool to run: npm test"
 * - XML-style tool tags
 */
export function extractToolCalls(
  output: string
): { tool: string; args?: Record<string, unknown> }[] {
  const toolCalls: { tool: string; args?: Record<string, unknown> }[] = [];

  // Pattern 1: "Using <Tool> tool" pattern (Claude Code standard format)
  const usingToolPattern =
    /Using\s+(\w+)\s+tool(?:\s+to\s+(?:read|write|run|execute|search|edit))?:?\s*(.+?)(?=\n|$)/gi;
  let match: RegExpExecArray | null;

  while ((match = usingToolPattern.exec(output)) !== null) {
    const tool = match[1];
    const argStr = match[2]?.trim();
    const args: Record<string, unknown> = {};

    if (argStr) {
      // Try to extract meaningful info from the arg string
      if (tool.toLowerCase() === 'read' || tool.toLowerCase() === 'write') {
        args.file = argStr;
      } else if (tool.toLowerCase() === 'bash') {
        args.command = argStr;
      } else if (tool.toLowerCase() === 'grep' || tool.toLowerCase() === 'glob') {
        args.pattern = argStr;
      } else {
        args.target = argStr;
      }
    }

    toolCalls.push({ tool, args: Object.keys(args).length > 0 ? args : undefined });
  }

  // Pattern 2: XML-style tool invocations <tool>Name</tool>
  const xmlToolPattern = /<tool>(\w+)<\/tool>/gi;
  while ((match = xmlToolPattern.exec(output)) !== null) {
    const tool = match[1];
    // Check if we already have this tool from another pattern
    if (!toolCalls.some((tc) => tc.tool.toLowerCase() === tool.toLowerCase())) {
      toolCalls.push({ tool });
    }
  }

  // Pattern 3: Tool call blocks with antml format
  const antmlToolPattern = /<invoke name="(\w+)">/gi;
  while ((match = antmlToolPattern.exec(output)) !== null) {
    const tool = match[1];
    toolCalls.push({ tool });
  }

  // Pattern 4: File operation patterns (implicit tool usage)
  // "Reading file.ts" or "Writing to file.ts"
  const readingPattern = /(?:^|\n)\s*Reading\s+([^\n]+)/gi;
  while ((match = readingPattern.exec(output)) !== null) {
    const file = match[1].trim();
    if (!toolCalls.some((tc) => tc.tool === 'Read' && tc.args?.file === file)) {
      toolCalls.push({ tool: 'Read', args: { file } });
    }
  }

  const writingPattern = /(?:^|\n)\s*Writing\s+(?:to\s+)?([^\n]+)/gi;
  while ((match = writingPattern.exec(output)) !== null) {
    const file = match[1].trim();
    if (!toolCalls.some((tc) => tc.tool === 'Write' && tc.args?.file === file)) {
      toolCalls.push({ tool: 'Write', args: { file } });
    }
  }

  // Pattern 5: Running command patterns
  const runningPattern = /(?:^|\n)\s*(?:Running|Executing):\s*(.+?)(?=\n|$)/gi;
  while ((match = runningPattern.exec(output)) !== null) {
    const command = match[1].trim();
    toolCalls.push({ tool: 'Bash', args: { command } });
  }

  return toolCalls;
}

/**
 * Estimate progress percentage from output patterns
 * Uses heuristics based on:
 * - Tool call count
 * - Presence of key phases (reading, implementing, testing)
 * - Completion/blocked markers
 */
export function estimateProgress(
  output: string,
  toolCalls: { tool: string; args?: Record<string, unknown> }[],
  isComplete: boolean,
  isBlocked: boolean
): number {
  // If complete, return 100
  if (isComplete) {
    return 100;
  }

  // If blocked, return current estimated progress (but cap at 90)
  let progress = 0;

  // Base progress from tool calls (each tool call = ~5% progress, up to 50%)
  const toolProgress = Math.min(toolCalls.length * 5, 50);
  progress += toolProgress;

  // Check for phase indicators in output
  const lowerOutput = output.toLowerCase();

  // Reading/analysis phase (0-20%)
  if (
    lowerOutput.includes('reading') ||
    lowerOutput.includes('analyzing') ||
    lowerOutput.includes('searching')
  ) {
    progress = Math.max(progress, 10);
  }

  // Implementation phase (20-60%)
  if (
    lowerOutput.includes('implementing') ||
    lowerOutput.includes('writing') ||
    lowerOutput.includes('creating') ||
    lowerOutput.includes('editing')
  ) {
    progress = Math.max(progress, 30);
  }

  // Testing phase (60-90%)
  if (
    lowerOutput.includes('running test') ||
    lowerOutput.includes('npm test') ||
    lowerOutput.includes('bun test') ||
    lowerOutput.includes('typecheck') ||
    lowerOutput.includes('validation')
  ) {
    progress = Math.max(progress, 70);
  }

  // Check for test results
  if (
    lowerOutput.includes('tests passed') ||
    lowerOutput.includes('all tests') ||
    lowerOutput.includes('✓') ||
    lowerOutput.includes('pass')
  ) {
    progress = Math.max(progress, 85);
  }

  // If blocked, cap at 90
  if (isBlocked) {
    progress = Math.min(progress, 90);
  }

  // Cap non-complete progress at 95
  return Math.min(progress, 95);
}

/**
 * Streaming output buffer for handling partial lines
 * Accumulates output and provides complete lines for parsing
 */
export class StreamingOutputBuffer {
  private buffer: string = '';
  private parsedOutput: ParsedOutput = {
    isComplete: false,
    isBlocked: false,
    toolCalls: [],
    progress: 0,
  };

  /**
   * Append new chunk of output to buffer
   * Returns updated parsed output
   */
  append(chunk: string): ParsedOutput {
    this.buffer += chunk;

    // Re-parse the accumulated buffer
    this.parsedOutput = parseAgentOutput(this.buffer);

    return this.parsedOutput;
  }

  /**
   * Get the current parsed output
   */
  getParsed(): ParsedOutput {
    return this.parsedOutput;
  }

  /**
   * Get the full accumulated buffer
   */
  getBuffer(): string {
    return this.buffer;
  }

  /**
   * Get complete lines from buffer (for processing line-by-line)
   * Returns array of complete lines, leaving partial line in buffer
   */
  getCompleteLines(): string[] {
    const lines = this.buffer.split('\n');

    // If buffer doesn't end with newline, last element is partial
    if (!this.buffer.endsWith('\n') && lines.length > 0) {
      // Keep partial line in a separate tracking (but keep full buffer for parsing)
      return lines.slice(0, -1);
    }

    return lines.filter((line) => line.length > 0);
  }

  /**
   * Reset the buffer
   */
  reset(): void {
    this.buffer = '';
    this.parsedOutput = {
      isComplete: false,
      isBlocked: false,
      toolCalls: [],
      progress: 0,
    };
  }
}

/**
 * Check if output contains completion marker
 */
export function isComplete(output: string): boolean {
  return /=== TICKET T\d+ COMPLETE ===/i.test(output);
}

/**
 * Check if output contains blocked marker
 */
export function isBlocked(output: string): { blocked: boolean; reason?: string } {
  const match = output.match(/=== TICKET T\d+ BLOCKED:\s*(.+?)\s*===/i);
  if (match) {
    return { blocked: true, reason: match[1] };
  }
  return { blocked: false };
}

// =============================================================================
// Prompt building
// =============================================================================

/**
 * Build the prompt for an implementation agent
 * Based on the prompt template from PLAN.md
 */
export function buildImplementationPrompt(
  ticket: Ticket,
  projectPath: string,
  workingDir: string,
  branch?: string,
  epicName?: string
): string {
  // Format acceptance criteria as bullet points
  const acceptanceCriteria = ticket.acceptanceCriteria
    .map((c) => `- ${c}`)
    .join('\n');

  // Format validation steps
  const validationSteps = ticket.validationSteps
    .map((s) => `- ${s}`)
    .join('\n');

  // Format dependencies if any
  const dependencies =
    ticket.dependencies.length > 0
      ? `\n## Dependencies\nThis ticket depends on: ${ticket.dependencies.join(', ')}`
      : '';

  // Include notes if present
  const notes = ticket.notes ? `\n## Notes\n${ticket.notes}` : '';

  // Include feedback if present (from previous review/QA rejection)
  const feedback = ticket.feedback
    ? `\n## Previous Feedback\n${ticket.feedback}`
    : '';

  // Build git/branch context section
  const branchName = branch || `ticket/${ticket.id}`;
  const gitContext = branch
    ? `
## Git Context
Branch: ${branchName}
Epic: ${epicName || ticket.epic || 'None'}

IMPORTANT: You are working in a dedicated worktree for this ticket.
- Before making changes, ensure you are on branch: ${branchName}
- If not on the correct branch, run: git checkout ${branchName} || git checkout -b ${branchName}
- All commits should be made to this branch, NOT to main
- Commit your changes with descriptive messages referencing ticket ${ticket.id}`
    : '';

  return `You are working on ticket ${ticket.id}: ${ticket.title}

## Context
Project: ${projectPath}
Working directory: ${workingDir}
Priority: ${ticket.priority}
Epic: ${epicName || ticket.epic || 'None'}
${gitContext}

## Your Task
${ticket.description || ticket.title}

## Acceptance Criteria
${acceptanceCriteria}

## Validation Steps
${validationSteps}
${dependencies}${notes}${feedback}

## Constraints
- Only modify files relevant to this ticket
- Run tests before reporting completion
${branch ? `- Commit all changes to branch: ${branchName}` : ''}- If blocked, output: === TICKET ${ticket.id} BLOCKED: [reason] ===

## When Complete
After all acceptance criteria are met and validation passes, output exactly:
=== TICKET ${ticket.id} COMPLETE ===
[Brief summary of changes made]`;
}

/**
 * Build the prompt for a review agent
 * Includes ticket context, git diff, review checklist, and output format
 */
export function buildReviewPrompt(
  ticket: Ticket,
  gitDiff: string,
  workingDir: string
): string {
  // Format acceptance criteria as bullet points
  const acceptanceCriteria = ticket.acceptanceCriteria.length > 0
    ? ticket.acceptanceCriteria.map((c) => `- ${c}`).join('\n')
    : '- No specific criteria defined';

  // Format validation steps
  const validationSteps = ticket.validationSteps.length > 0
    ? ticket.validationSteps.map((s) => `- ${s}`).join('\n')
    : '- No validation steps defined';

  // Include notes if present
  const notes = ticket.notes ? `\n## Notes\n${ticket.notes}` : '';

  // Build the comprehensive review prompt
  return `You are a code reviewer for ticket ${ticket.id}: ${ticket.title}

## Context
Working directory: ${workingDir}
Priority: ${ticket.priority}
Epic: ${ticket.epic || 'None'}

## Ticket Description
${ticket.description || ticket.title}

## Acceptance Criteria
${acceptanceCriteria}

## Validation Steps
${validationSteps}
${notes}

## Code Changes (Git Diff)
\`\`\`diff
${gitDiff}
\`\`\`

## Review Checklist
Please thoroughly review the changes for:

### 1. Security
- [ ] No hardcoded secrets, API keys, or credentials
- [ ] Input validation is proper where needed
- [ ] No SQL injection, XSS, or other injection vulnerabilities
- [ ] Proper authentication/authorization checks if applicable

### 2. Bugs & Logic Errors
- [ ] Edge cases are handled correctly
- [ ] Null/undefined checks are in place
- [ ] Error handling is appropriate
- [ ] No off-by-one errors or boundary issues
- [ ] Logic matches the acceptance criteria

### 3. Code Quality
- [ ] Code is readable and self-documenting
- [ ] Functions are single-purpose and not too long
- [ ] Variable/function names are clear and descriptive
- [ ] No unnecessary code duplication
- [ ] Types are properly defined (for TypeScript)

### 4. Patterns & Conventions
- [ ] Follows existing codebase patterns
- [ ] Consistent formatting and style
- [ ] Proper imports and exports
- [ ] Tests are included if applicable

## Output Format
After your review, output EXACTLY ONE of the following:

If the changes meet all acceptance criteria and pass the review checklist:
=== REVIEW DECISION: APPROVED ===
[Brief summary of what looks good]

If changes are needed:
=== REVIEW DECISION: CHANGES_REQUESTED ===
[List specific issues that need to be addressed]
- Issue 1: [severity: error|warning|info] [file:line if applicable] description
- Issue 2: [severity: error|warning|info] [file:line if applicable] description

IMPORTANT: You must output exactly one of these decision markers.`;
}

/**
 * Build the prompt for a QA agent
 * Includes ticket context, test scenarios, and bug report template
 */
export function buildQAPrompt(
  ticket: Ticket,
  workingDir: string
): string {
  // Format acceptance criteria as bullet points
  const acceptanceCriteria = ticket.acceptanceCriteria.length > 0
    ? ticket.acceptanceCriteria.map((c) => `- ${c}`).join('\n')
    : '- No specific criteria defined';

  // Format validation steps as test scenarios
  const validationSteps = ticket.validationSteps.length > 0
    ? ticket.validationSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '1. Verify basic functionality works as expected';

  // Include notes if present
  const notes = ticket.notes ? `\n## Notes\n${ticket.notes}` : '';

  // Include feedback if present (from previous review)
  const feedback = ticket.feedback
    ? `\n## Previous Feedback to Address\n${ticket.feedback}`
    : '';

  // Build the comprehensive QA prompt
  return `You are a QA tester for ticket ${ticket.id}: ${ticket.title}

## Context
Working directory: ${workingDir}
Priority: ${ticket.priority}
Epic: ${ticket.epic || 'None'}

## Ticket Description
${ticket.description || ticket.title}

## Acceptance Criteria
${acceptanceCriteria}
${notes}${feedback}

## Test Scenarios to Execute
${validationSteps}

## How to Run the Application
- Navigate to the working directory: ${workingDir}
- For tests: Run \`bun test\` or \`bun run test\`
- For typecheck: Run \`bun run typecheck\`
- For build: Run \`bun run build\`

## Your Testing Process
1. Read and understand the acceptance criteria
2. Execute each validation step listed above
3. Verify the implementation meets ALL acceptance criteria
4. Test edge cases and error handling:
   - Invalid inputs
   - Boundary conditions
   - Error states
   - Empty/null values
5. Check that error messages are clear and helpful

## Testing Guidelines
- Actually run the application/tests using the Bash tool
- Try both happy path and error scenarios
- Document exactly what you tested and the results
- If tests exist, run them and report results
- Check for regressions in existing functionality

## Output Format
After completing your testing, output EXACTLY ONE of the following:

If all tests pass and acceptance criteria are met:
=== QA DECISION: PASSED ===
Tests completed:
- [Test name]: PASS - [brief notes]
- [Test name]: PASS - [brief notes]
Summary: [Brief summary of what was tested]

If any tests fail or acceptance criteria are not met:
=== QA DECISION: FAILED ===
Bug Report:
- **Issue**: [Clear description of the failure]
- **Severity**: [critical|major|minor]
- **Steps to reproduce**:
  1. [Step 1]
  2. [Step 2]
- **Expected**: [What should happen]
- **Actual**: [What actually happened]
- **Suggested fix**: [If applicable]

Tests completed:
- [Test name]: PASS/FAIL - [brief notes]
- [Test name]: PASS/FAIL - [brief notes]

IMPORTANT: You must output exactly one of these decision markers.`;
}

// =============================================================================
// Token/Cost tracking helpers - T007
// =============================================================================

/**
 * Parse token usage from Claude output
 * Claude Code outputs token info in various formats
 */
export function parseTokenUsage(
  content: string
): { inputTokens: number; outputTokens: number } | null {
  // Pattern 1: "Tokens: input=1234, output=567"
  const tokenPattern = /tokens?:?\s*input[=:]\s*(\d+)[,\s]+output[=:]\s*(\d+)/i;
  const match1 = content.match(tokenPattern);
  if (match1) {
    return {
      inputTokens: parseInt(match1[1], 10),
      outputTokens: parseInt(match1[2], 10),
    };
  }

  // Pattern 2: "Input tokens: 1234\nOutput tokens: 567"
  const inputMatch = content.match(/input\s*tokens?:?\s*(\d+)/i);
  const outputMatch = content.match(/output\s*tokens?:?\s*(\d+)/i);
  if (inputMatch && outputMatch) {
    return {
      inputTokens: parseInt(inputMatch[1], 10),
      outputTokens: parseInt(outputMatch[1], 10),
    };
  }

  // Pattern 3: "Total tokens used: 1234" (estimate 80% input, 20% output)
  const totalMatch = content.match(/total\s*tokens?\s*(?:used)?:?\s*(\d+)/i);
  if (totalMatch) {
    const total = parseInt(totalMatch[1], 10);
    return {
      inputTokens: Math.round(total * 0.8),
      outputTokens: Math.round(total * 0.2),
    };
  }

  return null;
}

// =============================================================================
// Refine Agent - T036
// =============================================================================

export interface RefineAgentOptions {
  /** Working directory for the agent */
  workingDirectory: string;
  /** Current PLAN.md content for context */
  planContent: string;
  /** List of existing tickets for context */
  existingTicketIds: string[];
  /** List of epics with their paths */
  epics: { name: string; path: string; description?: string }[];
  /** Model to use (defaults to sonnet) */
  model?: string;
  /** Initial user message to start the conversation */
  userMessage?: string;
}

export interface RefineAgentResult {
  agentId: string;
  /** Promise that resolves with the full output when agent completes */
  output: Promise<string>;
  /** Stop the agent */
  stop: () => Promise<void>;
}

/**
 * Build the prompt for a Refine agent
 * Includes project context, PLAN.md structure, and ticket creation instructions
 */
export function buildRefinePrompt(
  planContent: string,
  existingTicketIds: string[],
  epics: { name: string; path: string; description?: string }[],
  projectPath: string,
  userMessage?: string
): string {
  const epicList = epics.length > 0
    ? epics.map(e => `- **${e.name}**: ${e.path}${e.description ? ` - ${e.description}` : ''}`).join('\n')
    : '(No epics defined)';

  const ticketIdList = existingTicketIds.length > 0
    ? existingTicketIds.join(', ')
    : '(No existing tickets)';

  const userRequest = userMessage
    ? `\n## User Request\n${userMessage}`
    : '';

  return `You are an AI assistant helping to create and refine tickets for a project.

## Project Context
Working directory: ${projectPath}

## Available Epics
${epicList}

## Existing Ticket IDs
${ticketIdList}

## Current PLAN.md Structure
The project uses a PLAN.md file to track tickets. Here's the current content for reference:
\`\`\`markdown
${planContent.slice(0, 5000)}${planContent.length > 5000 ? '\n... (truncated)' : ''}
\`\`\`
${userRequest}

## Your Role
Help the user create well-structured tickets for their project. When proposing tickets, use this exact format:

## Proposed Ticket: [Clear, actionable title]
- **Priority:** P0|P1|P2 (P0=critical, P1=high, P2=medium)
- **Epic:** [epic name from the list above, or leave blank if uncertain]
- **Description:** [Brief scope description of what this ticket accomplishes]
- **Acceptance Criteria:**
  - [Measurable criterion 1]
  - [Measurable criterion 2]
- **Validation Steps:**
  - [Command or test to verify, e.g., \`bun run typecheck\` passes]
  - [Another validation command]
- **Dependencies:** [comma-separated ticket IDs if any, e.g., T001, T002]

## Guidelines for Good Tickets
1. **Keep tickets focused** - Each ticket should be 1-2 days of work maximum
2. **Testable acceptance criteria** - Each criterion should be verifiable
3. **Include validation steps** - Commands that can verify the work is complete
4. **Assign appropriate epic** - Match the ticket to the relevant code area
5. **Identify dependencies** - List any tickets that must complete first
6. **Use clear titles** - Titles should describe the outcome, not the task

## Exploring the Codebase
You can read files in the codebase to understand the project structure before proposing tickets.
This helps you:
- Assign the correct epic based on file paths
- Understand existing patterns to follow
- Identify related code that might need updates
- Ensure acceptance criteria are appropriate

## When Proposing Multiple Tickets
If a user's request requires multiple tickets, propose them all with clear dependencies.
Number your proposals and explain how they relate to each other.

Now, help the user create or refine tickets for their project.`;
}

/**
 * Calculate cost from token usage
 * Using Claude Sonnet pricing as default
 */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  model: string = 'sonnet'
): number {
  // Pricing per million tokens (as of 2024)
  const pricing: Record<string, { input: number; output: number }> = {
    sonnet: { input: 3.0, output: 15.0 }, // Claude 3.5 Sonnet
    opus: { input: 15.0, output: 75.0 }, // Claude 3 Opus
    haiku: { input: 0.25, output: 1.25 }, // Claude 3 Haiku
  };

  const modelPricing = pricing[model.toLowerCase()] || pricing.sonnet;

  const inputCost = (inputTokens / 1_000_000) * modelPricing.input;
  const outputCost = (outputTokens / 1_000_000) * modelPricing.output;

  return inputCost + outputCost;
}
