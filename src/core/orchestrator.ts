/**
 * Orchestrator Engine
 *
 * The brain of ORCH. Coordinates tickets, agents, and state transitions.
 *
 * Implements: T004, T008, T009, T028
 */

import type { Ticket, TicketStatus, TicketPriority, Agent, OrchConfig, ValidationResult, AgentCompletedEvent, AgentFailedEvent, AgentBlockedEvent, ReviewResult } from './types';
import { getEventBus, EventBus } from './events';
import { PlanStore } from './plan-store';
import { AgentManager } from './agent-manager';
import { EpicManager } from './epic-manager';
import { runValidation as runValidationSteps } from './validation-runner';
import {
  isValidTransition,
  getNextStatus,
  canAdvance,
  canReject,
  canRetry,
  assertValidTransition,
} from './status-pipeline';
import { ReviewAgent, parseReviewDecision, isApproved, formatReviewFeedback } from './review-agent';

export class Orchestrator {
  private planStore: PlanStore;
  private agentManager: AgentManager;
  private epicManager: EpicManager;
  private reviewAgent: ReviewAgent;
  private config: OrchConfig;
  private running = false;
  private dependencyGraph: DependencyGraph;
  private eventBus: EventBus;
  private projectRoot: string;

  // Event unsubscribe functions for cleanup
  private unsubscribers: (() => void)[] = [];

  // Map agent IDs to ticket IDs for completion handling
  private agentTicketMap: Map<string, string> = new Map();

  // Map review agent IDs to ticket IDs
  private reviewAgentTicketMap: Map<string, string> = new Map();

  constructor(
    planStore: PlanStore,
    agentManager: AgentManager,
    epicManager: EpicManager,
    config: OrchConfig,
    projectRoot: string = process.cwd()
  ) {
    this.planStore = planStore;
    this.agentManager = agentManager;
    this.epicManager = epicManager;
    this.config = config;
    this.projectRoot = projectRoot;
    this.dependencyGraph = new DependencyGraph();
    this.eventBus = getEventBus();

    // Initialize review agent
    this.reviewAgent = new ReviewAgent({
      config,
      projectRoot,
    });
  }

  /**
   * Start the orchestrator
   * Loads plan, subscribes to events, begins processing
   */
  async start(): Promise<void> {
    if (this.running) {
      return; // Already running
    }

    // Load and parse the plan
    const plan = await this.planStore.load();

    // Build dependency graph from tickets
    this.dependencyGraph.build(plan.tickets);

    // Initialize epic manager with discovered epics
    const epics = this.epicManager.discoverEpics(plan.tickets);
    await this.epicManager.initialize(epics);

    // Subscribe to agent events
    this.subscribeToEvents();

    // Mark as running
    this.running = true;

    // Emit ready tickets event
    const readyTickets = this.getReadyTickets();
    if (readyTickets.length > 0) {
      this.eventBus.publish({
        type: 'tickets:ready',
        timestamp: new Date(),
      });
    }
  }

  /**
   * Subscribe to relevant events
   */
  private subscribeToEvents(): void {
    // Subscribe to agent:completed events
    const unsubCompleted = this.eventBus.subscribe<AgentCompletedEvent>(
      'agent:completed',
      (event) => {
        this.handleAgentComplete(event.agentId).catch((err) => {
          this.eventBus.publish({
            type: 'log:entry',
            timestamp: new Date(),
            level: 'error',
            message: `Error handling agent completion: ${err.message}`,
            agentId: event.agentId,
          });
        });
      }
    );
    this.unsubscribers.push(unsubCompleted);

    // Subscribe to agent:failed events
    const unsubFailed = this.eventBus.subscribe<AgentFailedEvent>(
      'agent:failed',
      (event) => {
        this.handleAgentFailed(event.agentId, event.error).catch((err) => {
          this.eventBus.publish({
            type: 'log:entry',
            timestamp: new Date(),
            level: 'error',
            message: `Error handling agent failure: ${err.message}`,
            agentId: event.agentId,
          });
        });
      }
    );
    this.unsubscribers.push(unsubFailed);

    // Subscribe to agent:blocked events
    const unsubBlocked = this.eventBus.subscribe<AgentBlockedEvent>(
      'agent:blocked',
      (event) => {
        this.handleAgentBlocked(event.agentId, event.reason).catch((err) => {
          this.eventBus.publish({
            type: 'log:entry',
            timestamp: new Date(),
            level: 'error',
            message: `Error handling agent blocked: ${err.message}`,
            agentId: event.agentId,
          });
        });
      }
    );
    this.unsubscribers.push(unsubBlocked);
  }

  /**
   * Stop the orchestrator gracefully
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return; // Not running
    }

    // Mark as not running first to prevent new operations
    this.running = false;

    // Stop all running agents (implementation and review)
    await this.agentManager.stopAll();
    await this.reviewAgent.stopAll();

    // Unsubscribe from all events
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];

    // Clear agent-ticket mappings
    this.agentTicketMap.clear();
    this.reviewAgentTicketMap.clear();
  }

  /**
   * Check if orchestrator is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get tickets ready for work (all dependencies met, status = Todo)
   */
  getReadyTickets(): Ticket[] {
    return this.dependencyGraph.getReadyTickets();
  }

  /**
   * Get tickets blocked by a specific ticket
   */
  getBlockedBy(ticketId: string): Ticket[] {
    return this.dependencyGraph.getBlockedBy(ticketId);
  }

  /**
   * Check for circular dependencies
   * Returns list of cycles found, or empty array if none
   */
  detectCircularDependencies(): string[][] {
    return this.dependencyGraph.detectCycles();
  }

  /**
   * Assign an agent to a ticket
   * Uses status-pipeline for transition validation
   */
  async assignTicket(ticketId: string): Promise<string> {
    if (!this.running) {
      throw new Error('Orchestrator is not running');
    }

    // Get the ticket
    const ticket = this.planStore.getTicket(ticketId);
    if (!ticket) {
      throw new Error(`Ticket not found: ${ticketId}`);
    }

    // Verify ticket is ready (Todo status and dependencies met)
    if (ticket.status !== 'Todo') {
      throw new Error(`Ticket ${ticketId} is not in Todo status (current: ${ticket.status})`);
    }

    // Validate status transition using pipeline
    assertValidTransition(ticket.status, 'InProgress', ticketId);

    const blockedBy = this.getBlockedBy(ticketId);
    if (blockedBy.length > 0) {
      const blockerIds = blockedBy.map(t => t.id).join(', ');
      throw new Error(`Ticket ${ticketId} is blocked by: ${blockerIds}`);
    }

    // Check if we can spawn more agents
    if (!this.agentManager.canSpawn()) {
      throw new Error(`Cannot spawn agent: max concurrency (${this.config.maxAgents}) reached`);
    }

    // Allocate worktree via epicManager
    const allocation = await this.epicManager.allocateWorktree(ticket, `agent-${ticketId}`);

    // Spawn agent via agentManager with epic context
    const agentId = await this.agentManager.spawn({
      ticketId,
      workingDirectory: allocation.worktreePath,
      agentType: 'Implementation',
      model: this.config.agentModel,
      ticket,
      projectPath: this.projectRoot,
      branch: allocation.branch,
      epicName: ticket.epic,
    });

    // Track agent-ticket mapping
    this.agentTicketMap.set(agentId, ticketId);

    // Update ticket status to InProgress and set owner
    await this.planStore.updateTicketStatus(ticketId, 'InProgress', 'Assigned to agent');
    await this.planStore.updateTicketOwner(ticketId, agentId);

    // Update dependency graph
    this.dependencyGraph.updateTicketStatus(ticketId, 'InProgress');

    // Emit ticket:assigned event
    this.eventBus.publish({
      type: 'ticket:assigned',
      timestamp: new Date(),
    });

    // Emit status change event
    this.eventBus.publish({
      type: 'ticket:status-changed',
      timestamp: new Date(),
      ticketId,
      previousStatus: 'Todo',
      newStatus: 'InProgress',
      reason: 'Assigned to agent',
    });

    return agentId;
  }

  /**
   * Handle agent completion
   */
  async handleAgentComplete(agentId: string): Promise<void> {
    if (!this.running) {
      return; // Orchestrator stopped
    }

    // Check if this is a review agent
    if (this.reviewAgentTicketMap.has(agentId)) {
      await this.handleReviewAgentComplete(agentId);
      return;
    }

    // Get ticket ID from mapping
    const ticketId = this.agentTicketMap.get(agentId);
    if (!ticketId) {
      this.eventBus.publish({
        type: 'log:entry',
        timestamp: new Date(),
        level: 'warn',
        message: `No ticket found for completed agent: ${agentId}`,
        agentId,
      });
      return;
    }

    // Get the ticket
    const ticket = this.planStore.getTicket(ticketId);
    if (!ticket) {
      return;
    }

    // Get working directory from worktree
    const worktree = this.epicManager.getWorktreeForAgent(agentId);
    const workingDir = worktree?.path || this.projectRoot;

    // Run validation steps
    const validationResult = await this.runValidation(ticket, workingDir);

    if (validationResult.passed) {
      // Validation passed - advance to next status based on automation config
      await this.advanceTicket(ticketId);
    } else {
      // Validation failed - mark ticket as failed
      const failedSteps = validationResult.steps
        .filter(s => !s.passed)
        .map(s => s.command)
        .join(', ');

      await this.planStore.updateTicketStatus(ticketId, 'Failed', `Validation failed: ${failedSteps}`);
      await this.planStore.addTicketFeedback(ticketId, `Validation failed:\n${formatValidationFailures(validationResult)}`);
      this.dependencyGraph.updateTicketStatus(ticketId, 'Failed');
    }

    // Release worktree
    await this.epicManager.releaseWorktree(agentId);

    // Clean up mapping
    this.agentTicketMap.delete(agentId);

    // Check for more ready tickets
    if (this.config.automation.ticketProgression === 'automatic') {
      await this.tick();
    }
  }

  /**
   * Handle agent failure
   */
  private async handleAgentFailed(agentId: string, error?: string): Promise<void> {
    if (!this.running) {
      return;
    }

    const ticketId = this.agentTicketMap.get(agentId);
    if (!ticketId) {
      return;
    }

    // Update ticket status to Failed
    await this.planStore.updateTicketStatus(ticketId, 'Failed', error || 'Agent failed');
    if (error) {
      await this.planStore.addTicketFeedback(ticketId, `Agent error: ${error}`);
    }
    this.dependencyGraph.updateTicketStatus(ticketId, 'Failed');

    // Release worktree
    await this.epicManager.releaseWorktree(agentId);

    // Clean up mapping
    this.agentTicketMap.delete(agentId);
  }

  /**
   * Handle agent blocked
   */
  private async handleAgentBlocked(agentId: string, reason?: string): Promise<void> {
    if (!this.running) {
      return;
    }

    const ticketId = this.agentTicketMap.get(agentId);
    if (!ticketId) {
      return;
    }

    // Keep ticket InProgress but add feedback about the blocker
    if (reason) {
      await this.planStore.addTicketFeedback(ticketId, `Agent blocked: ${reason}`);
    }

    // Emit log entry
    this.eventBus.publish({
      type: 'log:entry',
      timestamp: new Date(),
      level: 'warn',
      message: `Agent ${agentId} blocked on ticket ${ticketId}: ${reason || 'Unknown reason'}`,
      agentId,
      ticketId,
    });
  }

  /**
   * Run validation steps for a ticket
   */
  async runValidation(ticket: Ticket, workingDir?: string): Promise<ValidationResult> {
    const dir = workingDir || this.projectRoot;
    return runValidationSteps(ticket, dir);
  }

  /**
   * Move ticket to next status in pipeline
   * Uses status-pipeline for validation and next status determination
   */
  async advanceTicket(ticketId: string): Promise<void> {
    const ticket = this.planStore.getTicket(ticketId);
    if (!ticket) {
      throw new Error(`Ticket not found: ${ticketId}`);
    }

    const currentStatus = ticket.status;

    // Check if we can advance from current status
    if (!canAdvance(currentStatus)) {
      throw new Error(`Cannot advance ticket ${ticketId}: status ${currentStatus} is not advanceable`);
    }

    // Get next status based on automation config
    const nextStatus = getNextStatus(currentStatus, this.config.automation);
    if (!nextStatus) {
      // No next status means we're at the end
      return;
    }

    // Validate the transition
    assertValidTransition(currentStatus, nextStatus, ticketId);

    // Update status
    await this.planStore.updateTicketStatus(ticketId, nextStatus, `Advanced from ${currentStatus}`);
    this.dependencyGraph.updateTicketStatus(ticketId, nextStatus);

    // Emit status change event
    this.eventBus.publish({
      type: 'ticket:status-changed',
      timestamp: new Date(),
      ticketId,
      previousStatus: currentStatus,
      newStatus: nextStatus,
      reason: `Advanced from ${currentStatus}`,
    });

    // If ticket entered Review status, spawn review agent if automatic
    if (nextStatus === 'Review') {
      await this.spawnReviewAgentForTicket(ticketId);
    }

    // If we reached Done, check if this unblocks other tickets
    if (nextStatus === 'Done') {
      const readyTickets = this.getReadyTickets();
      if (readyTickets.length > 0) {
        this.eventBus.publish({
          type: 'tickets:ready',
          timestamp: new Date(),
        });
      }
    }
  }

  /**
   * Spawn a review agent for a ticket that entered Review status
   * Respects automation.review.mode setting
   */
  private async spawnReviewAgentForTicket(ticketId: string): Promise<void> {
    const ticket = this.planStore.getTicket(ticketId);
    if (!ticket) {
      return;
    }

    const reviewMode = this.config.automation.review.mode;

    // In manual mode, don't spawn review agent
    if (reviewMode === 'manual') {
      this.eventBus.publish({
        type: 'log:entry',
        timestamp: new Date(),
        level: 'info',
        message: `Ticket ${ticketId} entered Review - manual review required`,
        ticketId,
      });
      return;
    }

    // Get worktree path for the ticket
    const worktree = this.epicManager.getWorktreeByTicketId(ticketId);
    const workingDir = worktree?.path || this.projectRoot;

    try {
      // Spawn review agent
      const agentId = await this.reviewAgent.spawnReviewAgent(ticket, workingDir);

      // Track the review agent
      this.reviewAgentTicketMap.set(agentId, ticketId);

      this.eventBus.publish({
        type: 'log:entry',
        timestamp: new Date(),
        level: 'info',
        message: `Spawned review agent ${agentId} for ticket ${ticketId}`,
        agentId,
        ticketId,
      });

      // Subscribe to completion event for this review agent
      // The review agent emits agent:completed which we need to handle
      // This is handled via the general agent:completed subscription
    } catch (err) {
      this.eventBus.publish({
        type: 'log:entry',
        timestamp: new Date(),
        level: 'error',
        message: `Failed to spawn review agent for ${ticketId}: ${err instanceof Error ? err.message : String(err)}`,
        ticketId,
      });
    }
  }

  /**
   * Handle review agent completion
   * Called when a review agent finishes its work
   */
  async handleReviewAgentComplete(agentId: string): Promise<void> {
    if (!this.running) {
      return;
    }

    const ticketId = this.reviewAgentTicketMap.get(agentId);
    if (!ticketId) {
      return;
    }

    const ticket = this.planStore.getTicket(ticketId);
    if (!ticket) {
      return;
    }

    // Get the review result
    const reviewResult = this.reviewAgent.getReviewResult(agentId);
    const reviewMode = this.config.automation.review.mode;

    if (!reviewResult) {
      // No clear decision - log warning and leave ticket in Review
      this.eventBus.publish({
        type: 'log:entry',
        timestamp: new Date(),
        level: 'warn',
        message: `Review agent ${agentId} completed without clear decision for ticket ${ticketId}`,
        agentId,
        ticketId,
      });
      return;
    }

    // In approval mode, wait for human confirmation
    if (reviewMode === 'approval') {
      this.eventBus.publish({
        type: 'log:entry',
        timestamp: new Date(),
        level: 'info',
        message: `Review decision for ${ticketId}: ${reviewResult.decision} - awaiting human approval`,
        agentId,
        ticketId,
        data: { reviewResult },
      });
      return;
    }

    // In automatic mode, apply the decision
    await this.applyReviewDecision(ticketId, reviewResult);

    // Clean up
    this.reviewAgentTicketMap.delete(agentId);
  }

  /**
   * Apply a review decision to a ticket
   * Can be called automatically or after human approval
   */
  async applyReviewDecision(ticketId: string, reviewResult: ReviewResult): Promise<void> {
    const ticket = this.planStore.getTicket(ticketId);
    if (!ticket) {
      throw new Error(`Ticket not found: ${ticketId}`);
    }

    if (ticket.status !== 'Review') {
      throw new Error(`Cannot apply review decision: ticket ${ticketId} is not in Review status`);
    }

    if (isApproved(reviewResult)) {
      // Review approved - advance to QA or Done
      this.eventBus.publish({
        type: 'log:entry',
        timestamp: new Date(),
        level: 'info',
        message: `Review APPROVED for ticket ${ticketId}`,
        ticketId,
      });

      await this.advanceTicket(ticketId);
    } else {
      // Review rejected - send back to Todo with feedback
      const feedback = formatReviewFeedback(reviewResult);

      this.eventBus.publish({
        type: 'log:entry',
        timestamp: new Date(),
        level: 'info',
        message: `Review CHANGES_REQUESTED for ticket ${ticketId}`,
        ticketId,
        data: { feedback },
      });

      await this.rejectTicket(ticketId, feedback);
    }
  }

  /**
   * Manually approve a review decision (for approval mode)
   */
  async approveReviewDecision(ticketId: string): Promise<void> {
    const ticket = this.planStore.getTicket(ticketId);
    if (!ticket || ticket.status !== 'Review') {
      throw new Error(`Cannot approve: ticket ${ticketId} is not in Review status`);
    }

    // Find the review agent for this ticket
    let reviewAgentId: string | undefined;
    for (const [agentId, tId] of this.reviewAgentTicketMap) {
      if (tId === ticketId) {
        reviewAgentId = agentId;
        break;
      }
    }

    if (reviewAgentId) {
      const reviewResult = this.reviewAgent.getReviewResult(reviewAgentId);
      if (reviewResult) {
        await this.applyReviewDecision(ticketId, reviewResult);
        this.reviewAgentTicketMap.delete(reviewAgentId);
        return;
      }
    }

    // No review agent result - advance anyway (human approval)
    await this.advanceTicket(ticketId);
  }

  /**
   * Manually reject from review (for manual/approval modes)
   */
  async manualRejectReview(ticketId: string, feedback: string): Promise<void> {
    const ticket = this.planStore.getTicket(ticketId);
    if (!ticket || ticket.status !== 'Review') {
      throw new Error(`Cannot reject: ticket ${ticketId} is not in Review status`);
    }

    await this.rejectTicket(ticketId, feedback);

    // Clean up any associated review agent
    for (const [agentId, tId] of this.reviewAgentTicketMap) {
      if (tId === ticketId) {
        this.reviewAgentTicketMap.delete(agentId);
        break;
      }
    }
  }

  /**
   * Move ticket back to Todo (rejection from Review/QA)
   * Uses status-pipeline for validation
   */
  async rejectTicket(ticketId: string, feedback: string): Promise<void> {
    const ticket = this.planStore.getTicket(ticketId);
    if (!ticket) {
      throw new Error(`Ticket not found: ${ticketId}`);
    }

    const currentStatus = ticket.status;

    // Validate we can reject from current status
    if (!canReject(currentStatus)) {
      throw new Error(`Cannot reject ticket ${ticketId}: status ${currentStatus} cannot be rejected (only Review or QA can be rejected)`);
    }

    // Validate the transition to Todo
    assertValidTransition(currentStatus, 'Todo', ticketId);

    // Add feedback to ticket
    await this.planStore.addTicketFeedback(ticketId, feedback);

    // Set status back to Todo so it can be worked on again
    await this.planStore.updateTicketStatus(ticketId, 'Todo', 'Rejected with feedback');
    this.dependencyGraph.updateTicketStatus(ticketId, 'Todo');

    // Emit status change event
    this.eventBus.publish({
      type: 'ticket:status-changed',
      timestamp: new Date(),
      ticketId,
      previousStatus: currentStatus,
      newStatus: 'Todo',
      reason: `Rejected: ${feedback.substring(0, 100)}${feedback.length > 100 ? '...' : ''}`,
    });
  }

  /**
   * Retry a failed ticket
   * Uses status-pipeline for validation
   */
  async retryTicket(ticketId: string): Promise<void> {
    const ticket = this.planStore.getTicket(ticketId);
    if (!ticket) {
      throw new Error(`Ticket not found: ${ticketId}`);
    }

    const currentStatus = ticket.status;

    // Validate we can retry from current status
    if (!canRetry(currentStatus)) {
      throw new Error(`Cannot retry ticket ${ticketId}: status ${currentStatus} is not retryable (only Failed can be retried)`);
    }

    // Validate the transition to Todo
    assertValidTransition(currentStatus, 'Todo', ticketId);

    // Reset status to Todo
    await this.planStore.updateTicketStatus(ticketId, 'Todo', 'Retrying after failure');
    this.dependencyGraph.updateTicketStatus(ticketId, 'Todo');

    // Emit status change event
    this.eventBus.publish({
      type: 'ticket:status-changed',
      timestamp: new Date(),
      ticketId,
      previousStatus: currentStatus,
      newStatus: 'Todo',
      reason: 'Retrying after failure',
    });
  }

  /**
   * Process pending automation
   * Called periodically or on events
   */
  async tick(): Promise<void> {
    if (!this.running) {
      return;
    }

    // Only auto-assign in automatic mode
    if (this.config.automation.ticketProgression !== 'automatic') {
      return;
    }

    // Check for ready tickets
    const readyTickets = this.getReadyTickets();
    if (readyTickets.length === 0) {
      return;
    }

    // Try to assign agents to ready tickets (respects priority order from getReadyTickets)
    for (const ticket of readyTickets) {
      // Stop if we can't spawn more agents
      if (!this.agentManager.canSpawn()) {
        break;
      }

      try {
        await this.assignTicket(ticket.id);
        this.eventBus.publish({
          type: 'log:entry',
          timestamp: new Date(),
          level: 'info',
          message: `Auto-assigned agent to ticket ${ticket.id}`,
          ticketId: ticket.id,
        });
      } catch (err) {
        // Log error but continue trying other tickets
        this.eventBus.publish({
          type: 'log:entry',
          timestamp: new Date(),
          level: 'error',
          message: `Failed to auto-assign ticket ${ticket.id}: ${err instanceof Error ? err.message : String(err)}`,
          ticketId: ticket.id,
        });
      }
    }
  }

  /**
   * Reload the plan and rebuild the dependency graph
   */
  async reloadPlan(): Promise<void> {
    const plan = await this.planStore.load();
    this.dependencyGraph.build(plan.tickets);
  }

  /**
   * Get the dependency graph (for testing/inspection)
   */
  getDependencyGraph(): DependencyGraph {
    return this.dependencyGraph;
  }
}

/**
 * Format validation failures for feedback
 */
function formatValidationFailures(result: ValidationResult): string {
  return result.steps
    .filter(s => !s.passed)
    .map(s => `- ${s.command}: ${s.output.substring(0, 200)}${s.output.length > 200 ? '...' : ''}`)
    .join('\n');
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

// Note: Validation Runner (T009) is implemented in validation-runner.ts
// The runValidation method of Orchestrator delegates to it
