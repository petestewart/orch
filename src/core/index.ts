/**
 * Core module exports
 *
 * All orchestration logic is exported from here.
 */

// Types
export * from './types';

// Event system
export { EventBus, getEventBus, resetEventBus } from './events';

// Plan management
export { PlanStore, parseTicket, parseEpics, validatePlan } from './plan-store';

// Agent management
export {
  AgentManager,
  parseAgentOutput,
  isComplete,
  isBlocked,
  buildImplementationPrompt,
} from './agent-manager';

// Orchestration
export { Orchestrator, DependencyGraph, runValidationStep } from './orchestrator';

// Epic/Worktree management
export {
  EpicManager,
  createWorktree,
  removeWorktree,
  listWorktrees,
  mergeBranch,
  getTicketDiff,
} from './epic-manager';

// Specialized agents
export { ReviewAgent, buildReviewPromptFromTemplate, parseReviewDecision } from './review-agent';
export { QAAgent, buildQAPromptFromTemplate, parseQADecision } from './qa-agent';

// Configuration
export { loadConfig, validateConfig, getDefaultConfig, watchConfig } from './config';
