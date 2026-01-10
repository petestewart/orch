/**
 * Event-Driven State Store
 *
 * Subscribes to EventBus events and maintains derived state for the UI.
 * Replaces the prototype's mock-based store.
 *
 * Implements: T010
 */

import type { AppState, Epic, Ticket, Agent, LogEntry, TicketStatus } from './types.js';
import type {
  Ticket as CoreTicket,
  Agent as CoreAgent,
  Epic as CoreEpic,
  PlanLoadedEvent,
  TicketStatusChangedEvent,
  AgentSpawnedEvent,
  AgentProgressEvent,
  AgentCompletedEvent,
  AgentFailedEvent,
  AgentBlockedEvent,
  AgentStoppedEvent,
  LogEntryEvent,
  OrchEvent,
} from '../core/types.js';
import { getEventBus, EventBus } from '../core/events.js';

/**
 * Callback type for state change notifications
 */
type OnChangeCallback = (state: AppState) => void;

/**
 * Map core TicketStatus to UI TicketStatus
 */
function mapTicketStatus(status: CoreTicket['status']): TicketStatus {
  const statusMap: Record<CoreTicket['status'], TicketStatus> = {
    'Todo': 'backlog',
    'InProgress': 'in_progress',
    'Review': 'review',
    'QA': 'qa',
    'Done': 'done',
    'Failed': 'backlog', // Failed tickets go back to backlog for retry
  };
  return statusMap[status];
}

/**
 * Map core ticket priority to UI format
 */
function mapPriority(priority: CoreTicket['priority']): 'P1' | 'P2' | 'P3' {
  // Map P0 to P1 since UI only has P1, P2, P3
  if (priority === 'P0') return 'P1';
  return priority as 'P1' | 'P2' | 'P3';
}

/**
 * Map core Ticket to UI Ticket format
 */
function mapTicket(coreTicket: CoreTicket): Ticket {
  // Extract ticket number from ID (e.g., "T001" -> 1)
  const ticketNumber = parseInt(coreTicket.id.replace('T', ''), 10) || 0;

  // Determine if ticket is ready (no incomplete dependencies)
  // For now, a ticket is ready if it has no dependencies (they should be resolved externally)
  const ready = coreTicket.dependencies.length === 0;

  return {
    id: coreTicket.id.toLowerCase(), // UI uses lowercase IDs
    number: ticketNumber,
    title: coreTicket.title,
    epicId: coreTicket.epic || '', // Map epic name to epicId
    type: 'task', // Default type - could be enhanced based on ticket content
    status: mapTicketStatus(coreTicket.status),
    priority: mapPriority(coreTicket.priority),
    points: 1, // Default points - PLAN.md doesn't have points
    assignee: coreTicket.owner,
    blockedBy: coreTicket.dependencies.map(d => d.toLowerCase()),
    blocks: [], // Would need reverse dependency lookup
    ready,
    description: coreTicket.description,
    acceptanceCriteria: coreTicket.acceptanceCriteria,
    progress: coreTicket.status === 'InProgress' ? 50 : (coreTicket.status === 'Done' ? 100 : 0),
  };
}

/**
 * Map core AgentStatus to UI AgentStatus
 */
function mapAgentStatus(status: CoreAgent['status']): Agent['status'] {
  const statusMap: Record<CoreAgent['status'], Agent['status']> = {
    'Idle': 'idle',
    'Starting': 'working',
    'Working': 'working',
    'Validating': 'working',
    'Blocked': 'waiting',
    'Complete': 'idle',
    'Failed': 'idle',
  };
  return statusMap[status];
}

/**
 * Format elapsed time from milliseconds
 */
function formatElapsed(startedAt: Date | undefined): string {
  if (!startedAt) return '0s';
  const elapsed = Date.now() - startedAt.getTime();
  const seconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Map core Agent to UI Agent format
 */
function mapAgent(coreAgent: CoreAgent): Agent {
  return {
    id: coreAgent.id,
    name: coreAgent.id, // Use ID as name
    model: 'claude-sonnet', // Default model - could be enhanced
    status: mapAgentStatus(coreAgent.status),
    currentTicketId: coreAgent.ticketId?.toLowerCase(),
    progress: coreAgent.progress,
    elapsed: formatElapsed(coreAgent.startedAt),
    tokensIn: Math.round(coreAgent.tokensUsed * 0.8), // Estimate 80% input
    tokensOut: Math.round(coreAgent.tokensUsed * 0.2), // Estimate 20% output
    cost: coreAgent.cost,
    lastAction: coreAgent.lastAction,
  };
}

/**
 * Map core Epic to UI Epic format
 */
function mapEpic(coreEpic: CoreEpic, tickets: CoreTicket[]): Epic {
  // Find all tickets belonging to this epic
  const epicTicketIds = tickets
    .filter(t => t.epic === coreEpic.name)
    .map(t => t.id.toLowerCase());

  return {
    id: coreEpic.name.toLowerCase().replace(/\s+/g, '-'), // Generate ID from name
    name: coreEpic.name,
    ticketIds: epicTicketIds,
  };
}

/**
 * Map log level from core to UI format
 */
function mapLogLevel(level: LogEntryEvent['level']): LogEntry['level'] {
  const levelMap: Record<LogEntryEvent['level'], LogEntry['level']> = {
    'debug': 'INFO',
    'info': 'INFO',
    'warn': 'WARN',
    'error': 'ERROR',
    'event': 'EVENT',
  };
  return levelMap[level];
}

/**
 * Format timestamp for log display
 */
function formatTimestamp(date: Date): string {
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
}

export class Store {
  private state: AppState;
  private eventBus: EventBus;
  private unsubscribers: (() => void)[] = [];
  private onChangeCallbacks: OnChangeCallback[] = [];
  private logIdCounter = 0;

  // Store core data for mapping
  private coreTickets: Map<string, CoreTicket> = new Map();
  private coreAgents: Map<string, CoreAgent> = new Map();
  private coreEpics: Map<string, CoreEpic> = new Map();

  constructor(eventBus?: EventBus) {
    this.eventBus = eventBus || getEventBus();

    // Initialize with empty state (no mock data)
    this.state = {
      epics: [],
      tickets: [],
      agents: [],
      logs: [],
      selectedEpicIds: [],
      currentView: 'kanban',
      selectedColumnIndex: 0,
      selectedTicketIndex: 0,
      viewingTicketId: undefined,
      ticketViewTab: 'ticket',
      // Agents view state
      selectedAgentIndex: 0,
      // Logs view state
      selectedLogIndex: 0,
      // Plan view state
      planViewActivePane: 'chat',
      planViewActiveDoc: 'prd',
      // Refine view state
      refineViewActivePane: 'sidebar',
      refineViewSelectedTicket: 0,
    };

    // Subscribe to all relevant events
    this.subscribeToEvents();
  }

  /**
   * Subscribe to all relevant EventBus events
   */
  private subscribeToEvents(): void {
    // Plan events
    this.unsubscribers.push(
      this.eventBus.subscribe<PlanLoadedEvent>('plan:loaded', (event) => {
        this.handlePlanLoaded(event);
      })
    );

    // Ticket events
    this.unsubscribers.push(
      this.eventBus.subscribe<TicketStatusChangedEvent>('ticket:status-changed', (event) => {
        this.handleTicketStatusChanged(event);
      })
    );

    // Agent events
    this.unsubscribers.push(
      this.eventBus.subscribe<AgentSpawnedEvent>('agent:spawned', (event) => {
        this.handleAgentSpawned(event);
      })
    );

    this.unsubscribers.push(
      this.eventBus.subscribe<AgentProgressEvent>('agent:progress', (event) => {
        this.handleAgentProgress(event);
      })
    );

    this.unsubscribers.push(
      this.eventBus.subscribe<AgentCompletedEvent>('agent:completed', (event) => {
        this.handleAgentCompleted(event);
      })
    );

    this.unsubscribers.push(
      this.eventBus.subscribe<AgentFailedEvent>('agent:failed', (event) => {
        this.handleAgentFailed(event);
      })
    );

    this.unsubscribers.push(
      this.eventBus.subscribe<AgentBlockedEvent>('agent:blocked', (event) => {
        this.handleAgentBlocked(event);
      })
    );

    this.unsubscribers.push(
      this.eventBus.subscribe<AgentStoppedEvent>('agent:stopped', (event) => {
        this.handleAgentStopped(event);
      })
    );

    // Log events
    this.unsubscribers.push(
      this.eventBus.subscribe<LogEntryEvent>('log:entry', (event) => {
        this.handleLogEntry(event);
      })
    );
  }

  /**
   * Handle plan:loaded event - populates initial tickets and epics
   */
  private handlePlanLoaded(event: PlanLoadedEvent): void {
    // Store core data
    this.coreTickets.clear();
    this.coreEpics.clear();

    for (const ticket of event.tickets) {
      this.coreTickets.set(ticket.id, ticket);
    }

    for (const epic of event.epics) {
      this.coreEpics.set(epic.name, epic);
    }

    // Map to UI format
    this.state.tickets = event.tickets.map(mapTicket);
    this.state.epics = event.epics.map(epic => mapEpic(epic, event.tickets));

    // Update blockedBy relationships with computed reverse dependencies
    this.computeBlocksRelationships();

    // Select all epics by default
    this.state.selectedEpicIds = this.state.epics.map(e => e.id);

    // Add log entry for plan loaded
    this.addSystemLog('EVENT', `Plan loaded: ${event.tickets.length} tickets, ${event.epics.length} epics`);

    this.notifyChange();
  }

  /**
   * Compute reverse dependency relationships (blocks)
   */
  private computeBlocksRelationships(): void {
    // Build a map of ticket ID -> tickets it blocks
    const blocksMap = new Map<string, string[]>();

    for (const ticket of this.state.tickets) {
      for (const blockedById of ticket.blockedBy) {
        const blocks = blocksMap.get(blockedById) || [];
        blocks.push(ticket.id);
        blocksMap.set(blockedById, blocks);
      }
    }

    // Update tickets with blocks info
    for (const ticket of this.state.tickets) {
      ticket.blocks = blocksMap.get(ticket.id) || [];
    }
  }

  /**
   * Handle ticket:status-changed event
   */
  private handleTicketStatusChanged(event: TicketStatusChangedEvent): void {
    const ticketId = event.ticketId.toLowerCase();
    const ticket = this.state.tickets.find(t => t.id === ticketId);

    if (ticket) {
      ticket.status = mapTicketStatus(event.newStatus);

      // Update progress based on status
      if (event.newStatus === 'Done') {
        ticket.progress = 100;
      } else if (event.newStatus === 'InProgress') {
        ticket.progress = ticket.progress || 10;
      }

      // Update core ticket
      const coreTicket = this.coreTickets.get(event.ticketId);
      if (coreTicket) {
        coreTicket.status = event.newStatus;
      }

      // Add log entry
      this.addSystemLog('EVENT', `Ticket ${event.ticketId} status: ${event.previousStatus} -> ${event.newStatus}`, event.ticketId);

      this.notifyChange();
    }
  }

  /**
   * Handle agent:spawned event
   */
  private handleAgentSpawned(event: AgentSpawnedEvent): void {
    // Create new agent
    const coreAgent: CoreAgent = {
      id: event.agentId,
      type: 'Implementation',
      status: 'Starting',
      ticketId: event.ticketId,
      tokensUsed: 0,
      cost: 0,
      progress: 0,
      startedAt: event.timestamp,
    };

    this.coreAgents.set(event.agentId, coreAgent);
    this.state.agents.push(mapAgent(coreAgent));

    // Update ticket assignee
    const ticketId = event.ticketId.toLowerCase();
    const ticket = this.state.tickets.find(t => t.id === ticketId);
    if (ticket) {
      ticket.assignee = event.agentId;
    }

    // Add log entry
    this.addSystemLog('EVENT', `Agent ${event.agentId} spawned for ticket ${event.ticketId}`, event.ticketId, event.agentId);

    this.notifyChange();
  }

  /**
   * Handle agent:progress event
   */
  private handleAgentProgress(event: AgentProgressEvent): void {
    const coreAgent = this.coreAgents.get(event.agentId);
    if (coreAgent) {
      coreAgent.status = 'Working';
      coreAgent.progress = event.progress;
      coreAgent.lastAction = event.lastAction;
      coreAgent.tokensUsed = event.tokensUsed;

      // Update UI agent
      const agentIndex = this.state.agents.findIndex(a => a.id === event.agentId);
      if (agentIndex >= 0) {
        this.state.agents[agentIndex] = mapAgent(coreAgent);
      }

      // Update ticket progress
      const ticketId = event.ticketId.toLowerCase();
      const ticket = this.state.tickets.find(t => t.id === ticketId);
      if (ticket) {
        ticket.progress = event.progress;
      }

      // Add log entry for significant actions
      if (event.lastAction && event.lastAction.length > 0) {
        this.addSystemLog('INFO', event.lastAction.slice(0, 100), event.ticketId, event.agentId);
      }

      this.notifyChange();
    }
  }

  /**
   * Handle agent:completed event
   */
  private handleAgentCompleted(event: AgentCompletedEvent): void {
    const coreAgent = this.coreAgents.get(event.agentId);
    if (coreAgent) {
      coreAgent.status = 'Complete';
      coreAgent.progress = 100;

      // Update UI agent
      const agentIndex = this.state.agents.findIndex(a => a.id === event.agentId);
      if (agentIndex >= 0) {
        this.state.agents[agentIndex] = mapAgent(coreAgent);
      }

      // Add log entry
      this.addSystemLog('EVENT', `Agent ${event.agentId} completed ticket ${event.ticketId}`, event.ticketId, event.agentId);

      this.notifyChange();
    }
  }

  /**
   * Handle agent:failed event
   */
  private handleAgentFailed(event: AgentFailedEvent): void {
    const coreAgent = this.coreAgents.get(event.agentId);
    if (coreAgent) {
      coreAgent.status = 'Failed';

      // Update UI agent
      const agentIndex = this.state.agents.findIndex(a => a.id === event.agentId);
      if (agentIndex >= 0) {
        this.state.agents[agentIndex] = mapAgent(coreAgent);
      }

      // Add log entry
      this.addSystemLog('ERROR', `Agent ${event.agentId} failed: ${event.error || 'Unknown error'}`, event.ticketId, event.agentId);

      this.notifyChange();
    }
  }

  /**
   * Handle agent:blocked event
   */
  private handleAgentBlocked(event: AgentBlockedEvent): void {
    const coreAgent = this.coreAgents.get(event.agentId);
    if (coreAgent) {
      coreAgent.status = 'Blocked';

      // Update UI agent
      const agentIndex = this.state.agents.findIndex(a => a.id === event.agentId);
      if (agentIndex >= 0) {
        this.state.agents[agentIndex] = mapAgent(coreAgent);
      }

      // Add log entry
      this.addSystemLog('WARN', `Agent ${event.agentId} blocked: ${event.reason || 'Unknown reason'}`, event.ticketId, event.agentId);

      this.notifyChange();
    }
  }

  /**
   * Handle agent:stopped event
   */
  private handleAgentStopped(event: AgentStoppedEvent): void {
    const coreAgent = this.coreAgents.get(event.agentId);
    if (coreAgent) {
      coreAgent.status = 'Idle';

      // Update UI agent
      const agentIndex = this.state.agents.findIndex(a => a.id === event.agentId);
      if (agentIndex >= 0) {
        this.state.agents[agentIndex] = mapAgent(coreAgent);
      }

      // Add log entry
      this.addSystemLog('EVENT', `Agent ${event.agentId} stopped`, event.ticketId, event.agentId);

      this.notifyChange();
    }
  }

  /**
   * Handle log:entry event
   */
  private handleLogEntry(event: LogEntryEvent): void {
    const ticketNumber = event.ticketId
      ? parseInt(event.ticketId.replace(/^T/i, ''), 10) || undefined
      : undefined;

    const logEntry: LogEntry = {
      id: `l${++this.logIdCounter}`,
      timestamp: formatTimestamp(event.timestamp),
      level: mapLogLevel(event.level),
      agentId: event.agentId,
      ticketNumber,
      message: event.message,
    };

    // Add to beginning of logs (newest first)
    this.state.logs.unshift(logEntry);

    // Keep log size reasonable
    if (this.state.logs.length > 100) {
      this.state.logs.pop();
    }

    this.notifyChange();
  }

  /**
   * Add a system-generated log entry
   */
  private addSystemLog(
    level: LogEntry['level'],
    message: string,
    ticketId?: string,
    agentId?: string
  ): void {
    const ticketNumber = ticketId
      ? parseInt(ticketId.replace(/^T/i, ''), 10) || undefined
      : undefined;

    const logEntry: LogEntry = {
      id: `l${++this.logIdCounter}`,
      timestamp: formatTimestamp(new Date()),
      level,
      agentId,
      ticketNumber,
      message,
    };

    this.state.logs.unshift(logEntry);

    if (this.state.logs.length > 100) {
      this.state.logs.pop();
    }
  }

  /**
   * Register an onChange callback
   * Returns an unsubscribe function
   */
  onChange(callback: OnChangeCallback): () => void {
    this.onChangeCallbacks.push(callback);
    return () => {
      const index = this.onChangeCallbacks.indexOf(callback);
      if (index >= 0) {
        this.onChangeCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Notify all onChange callbacks
   */
  private notifyChange(): void {
    for (const callback of this.onChangeCallbacks) {
      callback(this.state);
    }
  }

  /**
   * Clean up subscriptions
   */
  destroy(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
    this.onChangeCallbacks = [];
  }

  // ============================================================================
  // Public API - compatible with existing UI components
  // ============================================================================

  getState(): AppState {
    return this.state;
  }

  getTicketsByStatus(status: TicketStatus): Ticket[] {
    return this.state.tickets
      .filter(t => t.status === status)
      .filter(t => this.state.selectedEpicIds.length === 0 || this.state.selectedEpicIds.includes(t.epicId));
  }

  getTicketById(id: string): Ticket | undefined {
    return this.state.tickets.find(t => t.id === id);
  }

  getEpicById(id: string): Epic | undefined {
    return this.state.epics.find(e => e.id === id);
  }

  getAgentById(id: string): Agent | undefined {
    return this.state.agents.find(a => a.id === id);
  }

  setCurrentView(view: AppState['currentView']) {
    this.state.currentView = view;
    this.notifyChange();
  }

  setSelectedTicket(ticketId?: string) {
    this.state.selectedTicketId = ticketId;
    this.notifyChange();
  }

  setSelectedColumn(index: number) {
    this.state.selectedColumnIndex = index;
    this.notifyChange();
  }

  setSelectedTicketIndex(index: number) {
    this.state.selectedTicketIndex = index;
    this.notifyChange();
  }

  setViewingTicketId(ticketId?: string) {
    this.state.viewingTicketId = ticketId;
    this.notifyChange();
  }

  setTicketViewTab(tab: 'ticket' | 'session') {
    this.state.ticketViewTab = tab;
    this.notifyChange();
  }

  setSelectedAgentIndex(index: number) {
    this.state.selectedAgentIndex = index;
    this.notifyChange();
  }

  setSelectedLogIndex(index: number) {
    this.state.selectedLogIndex = index;
    this.notifyChange();
  }

  setPlanViewActivePane(pane: 'chat' | 'docs') {
    this.state.planViewActivePane = pane;
    this.notifyChange();
  }

  setPlanViewActiveDoc(doc: 'prd' | 'plan' | 'tickets') {
    this.state.planViewActiveDoc = doc;
    this.notifyChange();
  }

  setRefineViewActivePane(pane: 'sidebar' | 'chat') {
    this.state.refineViewActivePane = pane;
    this.notifyChange();
  }

  setRefineViewSelectedTicket(index: number) {
    this.state.refineViewSelectedTicket = index;
    this.notifyChange();
  }

  // Removed simulation methods (updateAgentProgress, addRandomLogEntry)
  // Real data now comes from events
}
