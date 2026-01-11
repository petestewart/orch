export type TicketStatus = 'backlog' | 'in_progress' | 'review' | 'qa' | 'done'
export type TicketType = 'feature' | 'bug' | 'task'
export type Priority = 'P1' | 'P2' | 'P3'
export type AgentStatus = 'working' | 'waiting' | 'idle'
export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'EVENT'
export type TicketAutomationMode = 'automatic' | 'manual' | 'paused'

export interface Epic {
  id: string
  name: string
  ticketIds: string[]
}

export interface Ticket {
  id: string
  number: number
  title: string
  epicId: string
  type: TicketType
  status: TicketStatus
  priority: Priority
  points: number
  assignee?: string
  blockedBy: string[]
  blocks: string[]
  ready: boolean
  description?: string
  acceptanceCriteria: string[]
  progress?: number
  // Human intervention fields
  awaitingApproval?: boolean          // True when in Review/QA and waiting for human approval
  automationMode?: TicketAutomationMode  // Per-ticket automation override
  reviewOutput?: string               // Output from Review agent
  qaOutput?: string                   // Output from QA agent
  rejectionFeedback?: string          // Feedback when rejected from Review/QA
}

export interface Agent {
  id: string
  name: string
  model: string
  status: AgentStatus
  currentTicketId?: string
  progress: number
  elapsed: string
  tokensIn: number
  tokensOut: number
  cost: number
  lastAction?: string
}

export interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  agentId?: string
  ticketNumber?: number
  message: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

export interface AppState {
  epics: Epic[]
  tickets: Ticket[]
  agents: Agent[]
  logs: LogEntry[]
  selectedEpicIds: string[]
  currentView: 'plan' | 'refine' | 'kanban' | 'agents' | 'logs'
  selectedTicketId?: string
  selectedColumnIndex: number
  selectedTicketIndex: number
  viewingTicketId?: string
  ticketViewTab: 'ticket' | 'session'
  // Agents view state
  selectedAgentIndex: number
  // Logs view state
  selectedLogIndex: number
  logsLevelFilter?: LogLevel
  logsAgentFilter?: string
  logsTicketFilter?: number
  logsSearchQuery?: string
  logsAutoScroll: boolean
  // Plan view state
  planViewActivePane: 'chat' | 'docs'
  planViewActiveDoc: 'prd' | 'plan' | 'tickets'
  planViewChatMessages: ChatMessage[]
  planViewChatInput: string
  planViewChatCursor: number
  planViewPendingMessage: boolean // True when waiting for AI response
  planViewChatInputMode: boolean // True when chat input captures typing
  // Refine view state
  refineViewActivePane: 'sidebar' | 'chat' | 'audit'
  refineViewSelectedTicket: number
  refineViewChatMessages: ChatMessage[]  // T035: Chat messages for ticket creation
  refineViewChatInput: string  // T036: Current input text in chat pane
  refineViewChatCursor: number
  refineViewPendingMessage: boolean  // T035: Waiting for AI response
  refineViewChatInputMode: boolean // True when chat input captures typing
  // T035: AI-Assisted Ticket Creation state
  ticketProposals: TicketProposalUI[]  // Proposed tickets from AI
  selectedProposalIndex: number  // Index of selected proposal
  editingProposal?: TicketProposalUI  // Proposal being edited (for 'e' key)
  // Kanban epic grouping state (T034)
  kanbanEpicFilter?: string  // undefined = show all, string = filter by specific epic
  kanbanCollapsedEpics: Set<string>  // Set of epic IDs that are collapsed
  // Human intervention state (T029)
  confirmationDialog?: {
    title: string
    message: string
    confirmLabel: string
    cancelLabel: string
    onConfirm: () => void
    onCancel: () => void
  }
  // T039: Manual Ticket Creation Dialog
  manualTicketCreateDialog?: {
    isOpen: boolean
    title: string
    description: string
    priority: Priority
    epic: string
    acceptanceCriteria: string[]
    dependencies: string[]
    currentField: 'title' | 'description' | 'priority' | 'epic' | 'acceptanceCriteria' | 'dependencies'
  }
  // Plan Audit state (T038)
  auditInProgress: boolean
  auditPhase?: 'loading' | 'prd-comparison' | 'codebase-analysis' | 'dependency-check' | 'complete'
  auditProgress: number  // 0-100
  auditFindings: AuditFindingUI[]
  auditSummary?: {
    errors: number
    warnings: number
    infos: number
  }
  selectedAuditFindingIndex: number
  // Help Overlay state (T019)
  showHelpOverlay: boolean
  // Cost tracking state (T025)
  totalCost: number
}

export type AuditSeverity = 'error' | 'warning' | 'info'
export type AuditAction = 'create' | 'update' | 'deprecate' | 'review'

export interface AuditFindingUI {
  id: string
  severity: AuditSeverity
  category: string
  message: string
  ticketId?: string
  suggestedAction: AuditAction
  suggestedTicketTitle?: string
}

// Ticket Proposal types (T035: AI-Assisted Ticket Creation)
export interface TicketProposalUI {
  tempId: string
  title: string
  description?: string
  priority: Priority
  epic?: string
  acceptanceCriteria: string[]
  validationSteps: string[]
  dependencies: string[]
  reviewed: boolean
  selected: boolean  // Whether this proposal is selected for creation
}
