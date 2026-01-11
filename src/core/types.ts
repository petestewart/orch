/**
 * Core type definitions for ORCH
 *
 * Implements: Part of T002, T037
 */

// =============================================================================
// Ticket Types
// =============================================================================

export type TicketStatus =
  | 'Todo'
  | 'InProgress'
  | 'Review'
  | 'QA'
  | 'Done'
  | 'Failed';

export type TicketPriority = 'P0' | 'P1' | 'P2';

export interface Ticket {
  id: string;                          // e.g., "T001"
  title: string;
  description?: string;
  priority: TicketPriority;
  status: TicketStatus;
  epic?: string;                       // Epic name this ticket belongs to
  owner?: string;                      // Agent ID or "Unassigned"
  dependencies: string[];              // Ticket IDs that must complete first
  acceptanceCriteria: string[];
  validationSteps: string[];
  notes?: string;

  // Runtime fields (not persisted in PLAN.md)
  feedback?: string;                   // Feedback from Review/QA rejection
  assignedWorktree?: string;           // Worktree path if assigned
}

// =============================================================================
// Epic Types
// =============================================================================

export interface Epic {
  name: string;
  path: string;                        // Relative path to epic directory
  description?: string;
}

export interface Worktree {
  path: string;                        // Full path to worktree
  epicName: string;
  agentId: string;
  ticketId: string;
  branch: string;                      // e.g., "ticket/T001"
  createdAt: Date;
}

// =============================================================================
// Agent Types
// =============================================================================

export type AgentStatus =
  | 'Idle'
  | 'Starting'
  | 'Working'
  | 'Validating'
  | 'Blocked'
  | 'Complete'
  | 'Failed';

export type AgentType =
  | 'Implementation'
  | 'Review'
  | 'QA'
  | 'Refine'
  | 'Plan';

export interface Agent {
  id: string;                          // e.g., "agent-1"
  type: AgentType;
  status: AgentStatus;
  ticketId?: string;                   // Current ticket assignment
  workingDirectory?: string;           // Epic directory or worktree

  // Metrics
  startedAt?: Date;
  tokensUsed: number;
  cost: number;

  // Process info
  pid?: number;
  lastAction?: string;
  progress: number;                    // 0-100 estimated progress
}

// =============================================================================
// Configuration Types
// =============================================================================

export type AutomationMode = 'automatic' | 'approval' | 'manual';

export interface AutomationConfig {
  ticketProgression: AutomationMode;
  review: {
    mode: AutomationMode;
    model?: string;
  };
  qa: {
    mode: AutomationMode;
    model?: string;
  };
  planAudit?: {
    onRefineViewEntry: boolean;
  };
}

export interface CostLimitConfig {
  perTicket?: number;
  perSession?: number;
  action: 'pause' | 'warn' | 'stop';
}

export interface ErrorRecoveryConfig {
  /** Number of retry attempts for network/agent failures (default: 3) */
  maxRetries: number;
  /** Initial backoff delay in milliseconds (default: 1000) */
  initialBackoffMs: number;
  /** Maximum backoff delay in milliseconds (default: 30000) */
  maxBackoffMs: number;
  /** Backoff multiplier for exponential backoff (default: 2) */
  backoffMultiplier: number;
  /** Whether to auto-retry failed tickets (default: false) */
  autoRetryFailed: boolean;
}

export interface EpicConfig {
  autoCreateWorktrees: boolean;
  maxWorktreesPerEpic: number;
  cleanupOnMerge: boolean;
}

export interface OrchConfig {
  maxAgents: number;
  agentModel: string;
  planFile: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  automation: AutomationConfig;
  costLimit?: CostLimitConfig;
  errorRecovery?: ErrorRecoveryConfig;
  epics?: EpicConfig;
  ui?: {
    defaultView: string;
    refreshInterval: number;
    showCostInStatusBar: boolean;
  };
}

// =============================================================================
// Event Types
// =============================================================================

export type EventType =
  // Plan events
  | 'plan:loaded'
  | 'plan:updated'
  | 'plan:error'

  // Ticket events
  | 'ticket:status-changed'
  | 'ticket:assigned'
  | 'ticket:unassigned'
  | 'tickets:ready'

  // Agent events
  | 'agent:spawned'
  | 'agent:progress'
  | 'agent:completed'
  | 'agent:failed'
  | 'agent:blocked'
  | 'agent:stopped'
  | 'agent:stop-request'

  // Epic/Worktree events
  | 'epic:worktree-created'
  | 'epic:worktree-merged'
  | 'epic:conflict'

  // Log events
  | 'log:entry';

export interface BaseEvent {
  type: EventType;
  timestamp: Date;
}

export interface PlanLoadedEvent extends BaseEvent {
  type: 'plan:loaded';
  tickets: Ticket[];
  epics: Epic[];
}

export interface TicketStatusChangedEvent extends BaseEvent {
  type: 'ticket:status-changed';
  ticketId: string;
  previousStatus: TicketStatus;
  newStatus: TicketStatus;
  reason?: string;
}

export interface AgentProgressEvent extends BaseEvent {
  type: 'agent:progress';
  agentId: string;
  ticketId: string;
  progress: number;
  lastAction: string;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface AgentSpawnedEvent extends BaseEvent {
  type: 'agent:spawned';
  agentId: string;
  ticketId: string;
}

export interface AgentCompletedEvent extends BaseEvent {
  type: 'agent:completed';
  agentId: string;
  ticketId: string;
}

export interface AgentFailedEvent extends BaseEvent {
  type: 'agent:failed';
  agentId: string;
  ticketId: string;
  error?: string;
}

export interface AgentBlockedEvent extends BaseEvent {
  type: 'agent:blocked';
  agentId: string;
  ticketId: string;
  reason?: string;
}

export interface AgentStoppedEvent extends BaseEvent {
  type: 'agent:stopped';
  agentId: string;
  ticketId: string;
}

export interface AgentStopRequestEvent extends BaseEvent {
  type: 'agent:stop-request';
  agentId: string;
}

export interface LogEntryEvent extends BaseEvent {
  type: 'log:entry';
  level: 'debug' | 'info' | 'warn' | 'error' | 'event';
  message: string;
  agentId?: string;
  ticketId?: string;
  data?: Record<string, unknown>;
}

// Union of all event types
export type OrchEvent =
  | PlanLoadedEvent
  | TicketStatusChangedEvent
  | AgentProgressEvent
  | AgentSpawnedEvent
  | AgentCompletedEvent
  | AgentFailedEvent
  | AgentBlockedEvent
  | AgentStoppedEvent
  | AgentStopRequestEvent
  | LogEntryEvent
  | BaseEvent;

// =============================================================================
// Validation Types
// =============================================================================

export interface ValidationResult {
  passed: boolean;
  steps: {
    command: string;
    passed: boolean;
    output: string;
    duration: number;
  }[];
  totalDuration: number;
}

// =============================================================================
// Review/QA Types
// =============================================================================

export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED';
export type QADecision = 'PASSED' | 'FAILED';

export interface ReviewResult {
  decision: ReviewDecision;
  feedback?: string;
  issues?: {
    severity: 'error' | 'warning' | 'info';
    file?: string;
    line?: number;
    message: string;
  }[];
}

export interface QAResult {
  decision: QADecision;
  testResults?: {
    name: string;
    passed: boolean;
    notes?: string;
  }[];
  bugReport?: string;
}

// =============================================================================
// Audit Types
// =============================================================================

export type AuditFindingSeverity = 'error' | 'warning' | 'info';
export type AuditAction = 'create' | 'update' | 'deprecate' | 'review';

export interface AuditFinding {
  severity: AuditFindingSeverity;
  category: 'coverage' | 'accuracy' | 'staleness' | 'orphaned' | 'dependency';
  message: string;
  ticketId?: string;
  suggestedAction: AuditAction;
  suggestedTicket?: Partial<Ticket>;
}

export interface AuditResult {
  findings: AuditFinding[];
  summary: {
    errors: number;
    warnings: number;
    infos: number;
  };
  auditedAt: Date;
}
