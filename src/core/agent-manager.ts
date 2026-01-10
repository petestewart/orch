/**
 * Agent Manager
 *
 * Manages agent lifecycle: spawning, monitoring, stopping.
 * Wraps Claude Code CLI subprocess.
 *
 * Implements: T005, T006, T007
 */

import type { Agent, AgentType, Ticket } from './types';
import { getEventBus } from './events';

export interface SpawnOptions {
  ticketId: string;
  workingDirectory: string;
  agentType?: AgentType;
  model?: string;
}

export interface AgentOutput {
  type: 'stdout' | 'stderr';
  content: string;
  timestamp: Date;
}

export class AgentManager {
  private agents: Map<string, Agent> = new Map();
  private processes: Map<string, unknown> = new Map(); // subprocess handles
  private outputBuffers: Map<string, AgentOutput[]> = new Map();
  private maxAgents: number;
  private defaultModel: string;

  constructor(maxAgents = 5, defaultModel = 'sonnet') {
    this.maxAgents = maxAgents;
    this.defaultModel = defaultModel;
  }

  /**
   * Spawn a new agent for a ticket
   * Returns the agent ID
   */
  async spawn(options: SpawnOptions): Promise<string> {
    // TODO: Implement - T005, T007
    // - Check concurrency limit
    // - Generate agent ID
    // - Build prompt from ticket
    // - Spawn claude subprocess with --print flag
    // - Set up output capture
    // - Emit agent:spawned event
    throw new Error('Not implemented');
  }

  /**
   * Stop an agent gracefully
   * Sends SIGTERM, waits, then SIGKILL if needed
   */
  async stop(agentId: string): Promise<void> {
    // TODO: Implement - T007, T016
    // - Send SIGTERM to process
    // - Wait up to 5 seconds
    // - If still running, SIGKILL
    // - Clean up state
    // - Emit agent:stopped event
    throw new Error('Not implemented');
  }

  /**
   * Stop all running agents
   */
  async stopAll(): Promise<void> {
    // TODO: Implement - T016
    const agentIds = Array.from(this.agents.keys());
    await Promise.all(agentIds.map(id => this.stop(id)));
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
 */
export function parseAgentOutput(output: string): ParsedOutput {
  // TODO: Implement - T006
  // - Detect === TICKET Txxx COMPLETE === marker
  // - Detect === TICKET Txxx BLOCKED: reason === marker
  // - Extract tool calls (Read, Write, Bash, etc.)
  // - Estimate progress based on output patterns
  throw new Error('Not implemented');
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
 */
export function buildImplementationPrompt(
  ticket: Ticket,
  projectPath: string,
  workingDir: string
): string {
  // TODO: Implement - Part of T005
  // See PLAN.md "Prompt Template (Agent)" section
  throw new Error('Not implemented');
}

/**
 * Build the prompt for a review agent
 */
export function buildReviewPrompt(
  ticket: Ticket,
  gitDiff: string,
  workingDir: string
): string {
  // TODO: Implement - T030
  throw new Error('Not implemented');
}

/**
 * Build the prompt for a QA agent
 */
export function buildQAPrompt(
  ticket: Ticket,
  workingDir: string
): string {
  // TODO: Implement - T030
  throw new Error('Not implemented');
}
