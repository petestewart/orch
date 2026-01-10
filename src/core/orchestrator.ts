/**
 * Orchestrator Engine
 *
 * The brain of ORCH. Coordinates tickets, agents, and state transitions.
 *
 * Implements: T004, T008, T009, T028
 */

import type { Ticket, TicketStatus, TicketPriority, Agent, OrchConfig, ValidationResult } from './types';
import { getEventBus } from './events';
import { PlanStore } from './plan-store';
import { AgentManager } from './agent-manager';
import { EpicManager } from './epic-manager';

export class Orchestrator {
  private planStore: PlanStore;
  private agentManager: AgentManager;
  private epicManager: EpicManager;
  private config: OrchConfig;
  private running = false;

  constructor(
    planStore: PlanStore,
    agentManager: AgentManager,
    epicManager: EpicManager,
    config: OrchConfig
  ) {
    this.planStore = planStore;
    this.agentManager = agentManager;
    this.epicManager = epicManager;
    this.config = config;
  }

  /**
   * Start the orchestrator
   * Loads plan, subscribes to events, begins processing
   */
  async start(): Promise<void> {
    // TODO: Implement - T008
    // - Load plan
    // - Build dependency graph
    // - Subscribe to agent events
    // - Set running = true
    throw new Error('Not implemented');
  }

  /**
   * Stop the orchestrator gracefully
   */
  async stop(): Promise<void> {
    // TODO: Implement - T008, T016
    // - Set running = false
    // - Stop all agents
    // - Unsubscribe from events
    throw new Error('Not implemented');
  }

  /**
   * Get tickets ready for work (all dependencies met, status = Todo)
   */
  getReadyTickets(): Ticket[] {
    // TODO: Implement - T004
    // - Get all tickets
    // - Filter to status = Todo
    // - Filter to all dependencies in Done status
    // - Sort by priority (P0 > P1 > P2)
    throw new Error('Not implemented');
  }

  /**
   * Get tickets blocked by a specific ticket
   */
  getBlockedBy(ticketId: string): Ticket[] {
    // TODO: Implement - T004
    throw new Error('Not implemented');
  }

  /**
   * Check for circular dependencies
   * Returns list of cycles found, or empty array if none
   */
  detectCircularDependencies(): string[][] {
    // TODO: Implement - T004
    throw new Error('Not implemented');
  }

  /**
   * Assign an agent to a ticket
   */
  async assignTicket(ticketId: string): Promise<string> {
    // TODO: Implement - T008
    // - Verify ticket is ready
    // - Allocate worktree via epicManager
    // - Spawn agent via agentManager
    // - Update ticket status to InProgress
    // - Return agent ID
    throw new Error('Not implemented');
  }

  /**
   * Handle agent completion
   */
  async handleAgentComplete(agentId: string): Promise<void> {
    // TODO: Implement - T008, T009
    // - Get agent and ticket
    // - Run validation steps
    // - If passed, move to Review (or QA/Done based on config)
    // - If failed, mark ticket Failed
    // - Spawn next agent for ready tickets
    throw new Error('Not implemented');
  }

  /**
   * Run validation steps for a ticket
   */
  async runValidation(ticket: Ticket): Promise<ValidationResult> {
    // TODO: Implement - T009
    // - Parse validation steps
    // - Run each command
    // - Capture output and exit codes
    // - Return result
    throw new Error('Not implemented');
  }

  /**
   * Move ticket to next status in pipeline
   */
  async advanceTicket(ticketId: string): Promise<void> {
    // TODO: Implement - T028
    // - Get current status
    // - Determine next status based on pipeline
    // - Spawn Review/QA agent if needed (based on automation config)
    // - Update status
    throw new Error('Not implemented');
  }

  /**
   * Move ticket back to InProgress (rejection from Review/QA)
   */
  async rejectTicket(ticketId: string, feedback: string): Promise<void> {
    // TODO: Implement - T028
    // - Add feedback to ticket
    // - Set status to InProgress
    throw new Error('Not implemented');
  }

  /**
   * Retry a failed ticket
   */
  async retryTicket(ticketId: string): Promise<void> {
    // TODO: Implement - T028
    // - Verify current status is Failed
    // - Clear feedback
    // - Set status to Todo
    throw new Error('Not implemented');
  }

  /**
   * Process pending automation
   * Called periodically or on events
   */
  async tick(): Promise<void> {
    // TODO: Implement - T008
    // - Check for ready tickets
    // - If auto-assign enabled, spawn agents
    // - Check for completed agents
    // - Process ticket transitions
    throw new Error('Not implemented');
  }
}

// =============================================================================
// Dependency Graph - T004
// =============================================================================

export class DependencyGraph {
  private adjacency: Map<string, Set<string>> = new Map(); // ticket -> dependencies
  private reverse: Map<string, Set<string>> = new Map();   // ticket -> dependents
  private tickets: Map<string, Ticket> = new Map();        // ticket ID -> ticket

  /**
   * Build graph from tickets
   */
  build(tickets: Ticket[]): void {
    // Clear existing graph
    this.adjacency.clear();
    this.reverse.clear();
    this.tickets.clear();

    // Store tickets by ID
    for (const ticket of tickets) {
      this.tickets.set(ticket.id, ticket);
      this.adjacency.set(ticket.id, new Set(ticket.dependencies));

      // Initialize reverse mapping for this ticket
      if (!this.reverse.has(ticket.id)) {
        this.reverse.set(ticket.id, new Set());
      }
    }

    // Build reverse graph (dependents)
    for (const ticket of tickets) {
      for (const depId of ticket.dependencies) {
        if (!this.reverse.has(depId)) {
          this.reverse.set(depId, new Set());
        }
        this.reverse.get(depId)!.add(ticket.id);
      }
    }
  }

  /**
   * Get direct dependencies of a ticket
   */
  getDependencies(ticketId: string): string[] {
    return Array.from(this.adjacency.get(ticketId) || []);
  }

  /**
   * Get tickets that depend on this ticket
   */
  getDependents(ticketId: string): string[] {
    return Array.from(this.reverse.get(ticketId) || []);
  }

  /**
   * Check if all dependencies are satisfied
   */
  areDependenciesMet(ticketId: string, doneTickets: Set<string>): boolean {
    const deps = this.adjacency.get(ticketId);
    if (!deps || deps.size === 0) {
      return true;
    }
    for (const depId of deps) {
      if (!doneTickets.has(depId)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get tickets that are ready (Todo status, all dependencies Done)
   */
  getReadyTickets(): Ticket[] {
    // Build set of done ticket IDs
    const doneTickets = new Set<string>();
    for (const [id, ticket] of this.tickets) {
      if (ticket.status === 'Done') {
        doneTickets.add(id);
      }
    }

    // Find ready tickets
    const ready: Ticket[] = [];
    for (const [id, ticket] of this.tickets) {
      if (ticket.status === 'Todo' && this.areDependenciesMet(id, doneTickets)) {
        ready.push(ticket);
      }
    }

    // Sort by priority (P0 > P1 > P2)
    ready.sort((a, b) => {
      const priorityOrder: Record<TicketPriority, number> = { P0: 0, P1: 1, P2: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    return ready;
  }

  /**
   * Get tickets blocking a specific ticket (dependencies that aren't Done)
   */
  getBlockedBy(ticketId: string): Ticket[] {
    const deps = this.adjacency.get(ticketId);
    if (!deps) {
      return [];
    }

    const blocking: Ticket[] = [];
    for (const depId of deps) {
      const depTicket = this.tickets.get(depId);
      if (depTicket && depTicket.status !== 'Done') {
        blocking.push(depTicket);
      }
    }

    return blocking;
  }

  /**
   * Update a ticket's status in the graph
   */
  updateTicketStatus(ticketId: string, newStatus: TicketStatus): void {
    const ticket = this.tickets.get(ticketId);
    if (ticket) {
      ticket.status = newStatus;
    }
  }

  /**
   * Get a ticket by ID
   */
  getTicket(ticketId: string): Ticket | undefined {
    return this.tickets.get(ticketId);
  }

  /**
   * Detect cycles using DFS with color-based algorithm
   * WHITE = 0 (unvisited), GRAY = 1 (in progress), BLACK = 2 (done)
   * Returns array of cycles, each cycle is array of ticket IDs
   */
  detectCycles(): string[][] {
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    const parent = new Map<string, string | null>();
    const cycles: string[][] = [];

    // Initialize all nodes as WHITE
    for (const ticketId of this.adjacency.keys()) {
      color.set(ticketId, WHITE);
    }

    const dfs = (node: string): void => {
      color.set(node, GRAY);

      const deps = this.adjacency.get(node) || new Set();
      for (const dep of deps) {
        // Only process nodes that exist in our graph
        if (!this.adjacency.has(dep)) {
          continue;
        }

        if (color.get(dep) === GRAY) {
          // Found a cycle - reconstruct it
          const cycle: string[] = [dep];
          let current = node;
          while (current !== dep) {
            cycle.push(current);
            current = parent.get(current)!;
            if (current === null) break;
          }
          cycle.reverse();
          cycles.push(cycle);
        } else if (color.get(dep) === WHITE) {
          parent.set(dep, node);
          dfs(dep);
        }
      }

      color.set(node, BLACK);
    };

    for (const ticketId of this.adjacency.keys()) {
      if (color.get(ticketId) === WHITE) {
        parent.set(ticketId, null);
        dfs(ticketId);
      }
    }

    return cycles;
  }

  /**
   * Get topological order (respecting dependencies)
   * Uses Kahn's algorithm
   */
  getTopologicalOrder(): string[] {
    // Check for cycles first
    const cycles = this.detectCycles();
    if (cycles.length > 0) {
      throw new Error(`Cannot compute topological order: circular dependencies detected`);
    }

    // Count in-degrees (number of dependencies)
    const inDegree = new Map<string, number>();
    for (const ticketId of this.adjacency.keys()) {
      inDegree.set(ticketId, 0);
    }

    for (const ticketId of this.adjacency.keys()) {
      const deps = this.adjacency.get(ticketId)!;
      // in-degree = number of dependencies (edges coming in)
      inDegree.set(ticketId, deps.size);
    }

    // Start with nodes that have no dependencies
    const queue: string[] = [];
    for (const [ticketId, degree] of inDegree) {
      if (degree === 0) {
        queue.push(ticketId);
      }
    }

    const result: string[] = [];

    while (queue.length > 0) {
      const node = queue.shift()!;
      result.push(node);

      // For each ticket that depends on this one, decrease their in-degree
      const dependents = this.reverse.get(node) || new Set();
      for (const dependent of dependents) {
        const newDegree = inDegree.get(dependent)! - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) {
          queue.push(dependent);
        }
      }
    }

    return result;
  }
}

// =============================================================================
// Validation Runner - T009
// =============================================================================

export interface ValidationStepResult {
  command: string;
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
}

/**
 * Run a single validation command
 */
export async function runValidationStep(
  command: string,
  workingDir: string,
  timeout?: number
): Promise<ValidationStepResult> {
  // TODO: Implement - T009
  // - Run command via subprocess
  // - Capture output
  // - Check exit code
  // - Handle timeout
  throw new Error('Not implemented');
}
