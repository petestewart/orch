/**
 * Graceful Shutdown Handler
 *
 * Manages graceful shutdown on SIGINT (Ctrl+C) and SIGTERM signals.
 * Stops all agents, preserves ticket states, and shows exit summary.
 *
 * Implements: T016
 */

import type { Orchestrator } from './orchestrator';
import type { AgentManager } from './agent-manager';
import type { PlanStore } from './plan-store';

export interface ShutdownOptions {
  orchestrator?: Orchestrator;
  agentManager?: AgentManager;
  planStore?: PlanStore;
  onShutdownStart?: () => void;
  onShutdownComplete?: (summary: ShutdownSummary) => void;
}

export interface ShutdownSummary {
  agentsStopped: number;
  ticketsInProgress: number;
  totalCost: number;
  elapsedMs: number;
}

// Global shutdown state
let isShuttingDown = false;
let shutdownOptions: ShutdownOptions = {};

/**
 * Register shutdown handlers for SIGINT and SIGTERM
 * Should be called once at application startup
 */
export function registerShutdownHandlers(options: ShutdownOptions): void {
  shutdownOptions = options;

  // Handle Ctrl+C (SIGINT)
  process.on('SIGINT', handleShutdownSignal);

  // Handle termination signal (SIGTERM)
  process.on('SIGTERM', handleShutdownSignal);
}

/**
 * Handle shutdown signal (SIGINT or SIGTERM)
 */
async function handleShutdownSignal(): Promise<void> {
  // Prevent multiple shutdown attempts
  if (isShuttingDown) {
    // If user presses Ctrl+C again during shutdown, force exit
    console.log('\nForce exiting...');
    process.exit(1);
  }

  isShuttingDown = true;

  // Notify that shutdown is starting
  if (shutdownOptions.onShutdownStart) {
    shutdownOptions.onShutdownStart();
  }

  try {
    const summary = await performGracefulShutdown();

    // Notify that shutdown is complete
    if (shutdownOptions.onShutdownComplete) {
      shutdownOptions.onShutdownComplete(summary);
    } else {
      // Print summary to console if no handler provided
      printShutdownSummary(summary);
    }
  } catch (error) {
    console.error('Error during shutdown:', error);
  }

  // Exit the process
  process.exit(0);
}

/**
 * Perform graceful shutdown
 * Stops all agents and collects summary information
 */
async function performGracefulShutdown(): Promise<ShutdownSummary> {
  const startTime = Date.now();
  let agentsStopped = 0;
  let ticketsInProgress = 0;
  let totalCost = 0;

  // Stop orchestrator if available (this stops all agents internally)
  if (shutdownOptions.orchestrator) {
    const orchestrator = shutdownOptions.orchestrator;

    // Check if orchestrator is running
    if (orchestrator.isRunning()) {
      await orchestrator.stop();
    }
  } else if (shutdownOptions.agentManager) {
    // Fallback: stop agents directly if no orchestrator
    const agentManager = shutdownOptions.agentManager;

    // Get agent count before stopping
    agentsStopped = agentManager.getActiveCount();

    // Get total cost before stopping
    const metrics = agentManager.getTotalMetrics();
    totalCost = metrics.cost;

    // Stop all agents
    await agentManager.stopAll();
  }

  // Get final agent count and metrics
  if (shutdownOptions.agentManager) {
    const agentManager = shutdownOptions.agentManager;
    const allAgents = agentManager.getAllAgents();
    agentsStopped = allAgents.filter(
      (a) => a.status === 'Starting' || a.status === 'Working'
    ).length;

    const metrics = agentManager.getTotalMetrics();
    totalCost = metrics.cost;
  }

  // Count tickets in progress (from plan store if available)
  if (shutdownOptions.planStore) {
    try {
      const tickets = shutdownOptions.planStore.getTickets();
      ticketsInProgress = tickets.filter(
        (t) => t.status === 'InProgress'
      ).length;
    } catch {
      // Plan not loaded, skip ticket counting
    }
  }

  return {
    agentsStopped,
    ticketsInProgress,
    totalCost,
    elapsedMs: Date.now() - startTime,
  };
}

/**
 * Print shutdown summary to console
 */
function printShutdownSummary(summary: ShutdownSummary): void {
  console.log('\n');
  console.log('=== ORCH Shutdown Summary ===');
  console.log(`Agents stopped: ${summary.agentsStopped}`);
  console.log(`Tickets in progress: ${summary.ticketsInProgress}`);
  if (summary.totalCost > 0) {
    console.log(`Total cost: $${summary.totalCost.toFixed(4)}`);
  }
  console.log(`Shutdown time: ${summary.elapsedMs}ms`);
  console.log('');
  if (summary.ticketsInProgress > 0) {
    console.log(
      'Note: Tickets left In Progress will remain in that state.'
    );
    console.log('They can be resumed or reset to Todo on next run.');
  }
  console.log('Goodbye!');
}

/**
 * Check if shutdown is in progress
 */
export function isShutdownInProgress(): boolean {
  return isShuttingDown;
}

/**
 * Trigger graceful shutdown programmatically
 * (e.g., from quit command in TUI)
 */
export async function triggerShutdown(): Promise<void> {
  await handleShutdownSignal();
}

/**
 * Unregister shutdown handlers (for testing)
 */
export function unregisterShutdownHandlers(): void {
  process.off('SIGINT', handleShutdownSignal);
  process.off('SIGTERM', handleShutdownSignal);
  isShuttingDown = false;
  shutdownOptions = {};
}
