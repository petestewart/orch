import type { AppState, Epic, Ticket, Agent, LogEntry, TicketStatus } from './types.js'

// Mock data
const mockEpics: Epic[] = [
  { id: 'e1', name: 'Auth v2', ticketIds: ['t31', 't32', 't35', 't38', 't39', 't42', 't43', 't45'] },
  { id: 'e2', name: 'Payments', ticketIds: ['t33', 't44'] },
]

const mockTickets: Ticket[] = [
  // Backlog
  {
    id: 't42', number: 42, title: 'OAuth flow', epicId: 'e1', type: 'feature',
    status: 'backlog', priority: 'P1', points: 3, assignee: 'a1',
    blockedBy: [], blocks: ['t43'], ready: true,
    description: 'Implement OAuth 2.0 authentication flow',
    acceptanceCriteria: [
      'User can initiate OAuth flow from login page',
      'Tokens are securely stored after successful auth',
      'Token refresh happens automatically before expiry',
    ],
  },
  {
    id: 't43', number: 43, title: 'Token refresh', epicId: 'e1', type: 'feature',
    status: 'backlog', priority: 'P2', points: 2, blockedBy: ['t42'], blocks: [],
    ready: false, description: 'Handle automatic token refresh',
    acceptanceCriteria: ['Tokens refresh before expiry', 'User session persists'],
  },
  {
    id: 't44', number: 44, title: 'Webhook handler', epicId: 'e2', type: 'task',
    status: 'backlog', priority: 'P3', points: 1, blockedBy: [], blocks: [],
    ready: true, description: 'Process incoming webhooks',
    acceptanceCriteria: ['Validate webhook signatures', 'Process events asynchronously'],
  },
  {
    id: 't45', number: 45, title: 'Rate limiting', epicId: 'e1', type: 'bug',
    status: 'backlog', priority: 'P1', points: 1, blockedBy: [], blocks: [],
    ready: true, description: 'Fix rate limiting on auth endpoints',
    acceptanceCriteria: ['Rate limits enforced correctly', 'Clear error messages'],
  },
  // In Progress
  {
    id: 't38', number: 38, title: 'JWT tokens', epicId: 'e1', type: 'feature',
    status: 'in_progress', priority: 'P2', points: 2, assignee: 'a2',
    blockedBy: [], blocks: [], ready: true, progress: 40,
    description: 'Implement JWT token generation and validation',
    acceptanceCriteria: ['Tokens generated with correct claims', 'Validation rejects expired tokens'],
  },
  {
    id: 't39', number: 39, title: 'Session mgmt', epicId: 'e1', type: 'task',
    status: 'in_progress', priority: 'P3', points: 1, assignee: 'a1',
    blockedBy: [], blocks: [], ready: true, progress: 95,
    description: 'Session management with Redis backend',
    acceptanceCriteria: ['Sessions stored in Redis', 'Session expiry works'],
  },
  // Review
  {
    id: 't35', number: 35, title: 'Login UI', epicId: 'e1', type: 'feature',
    status: 'review', priority: 'P2', points: 1, assignee: 'a3',
    blockedBy: [], blocks: [], ready: true, progress: 100,
    description: 'Build login form with email/password and OAuth buttons',
    acceptanceCriteria: ['Form validates input', 'Shows loading state', 'Error messages display'],
  },
  // Done
  {
    id: 't31', number: 31, title: 'DB schema', epicId: 'e1', type: 'task',
    status: 'done', priority: 'P1', points: 1, assignee: 'a1',
    blockedBy: [], blocks: [], ready: true,
    description: 'Create database schema for auth tables',
    acceptanceCriteria: ['Schema created', 'Migrations run'],
  },
  {
    id: 't32', number: 32, title: 'API routes', epicId: 'e1', type: 'feature',
    status: 'done', priority: 'P1', points: 2, assignee: 'a2',
    blockedBy: [], blocks: [], ready: true,
    description: 'Create auth API routes',
    acceptanceCriteria: ['Routes respond correctly', 'Auth middleware works'],
  },
  {
    id: 't33', number: 33, title: 'Payment hook', epicId: 'e2', type: 'task',
    status: 'done', priority: 'P2', points: 1, assignee: 'a3',
    blockedBy: [], blocks: [], ready: true,
    description: 'Implement Stripe webhook handler',
    acceptanceCriteria: ['Webhook signature validated', 'Events processed'],
  },
]

const mockAgents: Agent[] = [
  {
    id: 'a1', name: 'a1', model: 'claude-sonnet',
    status: 'working', currentTicketId: 't39', progress: 95,
    elapsed: '7m 12s', tokensIn: 12847, tokensOut: 8234, cost: 0.89,
    lastAction: 'Running tests: src/auth/__tests__/session.test.ts',
  },
  {
    id: 'a2', name: 'a2', model: 'claude-sonnet',
    status: 'working', currentTicketId: 't38', progress: 78,
    elapsed: '4m 32s', tokensIn: 8421, tokensOut: 5892, cost: 0.62,
    lastAction: 'Writing file: src/auth/jwt.service.ts',
  },
  {
    id: 'a3', name: 'a3', model: 'claude-sonnet',
    status: 'waiting', currentTicketId: 't35', progress: 100,
    elapsed: '12m 05s', tokensIn: 15234, tokensOut: 11456, cost: 0.96,
    lastAction: 'Completed task, awaiting review approval',
  },
  {
    id: 'a4', name: 'a4', model: 'claude-haiku',
    status: 'idle', progress: 0, elapsed: '0s',
    tokensIn: 0, tokensOut: 0, cost: 0, lastAction: 'Ready for assignment',
  },
]

const mockLogs: LogEntry[] = [
  { id: 'l1', timestamp: '12:47:32', level: 'INFO', agentId: 'a2', ticketNumber: 38, message: 'Completed writing src/auth/jwt.service.ts (142 lines)' },
  { id: 'l2', timestamp: '12:47:28', level: 'INFO', agentId: 'a2', ticketNumber: 38, message: 'Writing file: src/auth/jwt.service.ts' },
  { id: 'l3', timestamp: '12:47:15', level: 'INFO', agentId: 'a2', ticketNumber: 38, message: 'Read file: src/auth/index.ts (58 lines)' },
  { id: 'l4', timestamp: '12:47:12', level: 'INFO', agentId: 'a2', ticketNumber: 38, message: 'Starting task: JWT tokens implementation' },
  { id: 'l5', timestamp: '12:47:10', level: 'EVENT', agentId: 'a2', ticketNumber: 38, message: 'Agent assigned to ticket' },
  { id: 'l6', timestamp: '12:46:58', level: 'EVENT', ticketNumber: 38, message: 'Status changed: Backlog -> In Progress' },
  { id: 'l7', timestamp: '12:46:55', level: 'INFO', agentId: 'a1', ticketNumber: 39, message: 'Completed task: Session management' },
  { id: 'l8', timestamp: '12:46:42', level: 'WARN', agentId: 'a1', ticketNumber: 39, message: 'Retry attempt 2/3 for API call' },
  { id: 'l9', timestamp: '12:46:38', level: 'WARN', agentId: 'a1', ticketNumber: 39, message: 'API timeout, retrying...' },
  { id: 'l10', timestamp: '12:45:21', level: 'INFO', agentId: 'a1', ticketNumber: 39, message: 'Running tests: src/auth/__tests__/session.test.ts' },
  { id: 'l11', timestamp: '12:44:58', level: 'INFO', agentId: 'a1', ticketNumber: 39, message: 'Writing file: src/auth/session.service.ts' },
  { id: 'l12', timestamp: '12:43:12', level: 'INFO', agentId: 'a3', ticketNumber: 35, message: 'Completed task: Login UI component' },
  { id: 'l13', timestamp: '12:43:10', level: 'EVENT', ticketNumber: 35, message: 'Status changed: In Progress -> Review' },
  { id: 'l14', timestamp: '12:42:55', level: 'INFO', agentId: 'a3', ticketNumber: 35, message: 'All tests passing (12/12)' },
  { id: 'l15', timestamp: '12:42:31', level: 'ERROR', agentId: 'a3', ticketNumber: 35, message: "Test failed: LoginForm.test.tsx - expected 'Submit' got 'Login'" },
  { id: 'l16', timestamp: '12:42:28', level: 'INFO', agentId: 'a3', ticketNumber: 35, message: 'Running tests: src/components/__tests__/LoginForm.test.tsx' },
  { id: 'l17', timestamp: '12:41:45', level: 'INFO', agentId: 'a3', ticketNumber: 35, message: 'Writing file: src/components/LoginForm.tsx' },
  { id: 'l18', timestamp: '12:40:22', level: 'EVENT', ticketNumber: 42, message: 'Ticket created: OAuth flow implementation' },
  { id: 'l19', timestamp: '12:40:18', level: 'EVENT', ticketNumber: 43, message: 'Dependency added: #43 blocked by #42' },
  { id: 'l20', timestamp: '12:38:42', level: 'INFO', message: 'System initialized, 3 agents available' },
]

export class Store {
  private state: AppState

  constructor() {
    this.state = {
      epics: mockEpics,
      tickets: mockTickets,
      agents: mockAgents,
      logs: mockLogs,
      selectedEpicIds: ['e1', 'e2'],
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
    }
  }

  getState(): AppState {
    return this.state
  }

  getTicketsByStatus(status: TicketStatus): Ticket[] {
    return this.state.tickets
      .filter(t => t.status === status)
      .filter(t => this.state.selectedEpicIds.includes(t.epicId))
  }

  getTicketById(id: string): Ticket | undefined {
    return this.state.tickets.find(t => t.id === id)
  }

  getEpicById(id: string): Epic | undefined {
    return this.state.epics.find(e => e.id === id)
  }

  getAgentById(id: string): Agent | undefined {
    return this.state.agents.find(a => a.id === id)
  }

  setCurrentView(view: AppState['currentView']) {
    this.state.currentView = view
  }

  setSelectedTicket(ticketId?: string) {
    this.state.selectedTicketId = ticketId
  }

  setSelectedColumn(index: number) {
    this.state.selectedColumnIndex = index
  }

  setSelectedTicketIndex(index: number) {
    this.state.selectedTicketIndex = index
  }

  setViewingTicketId(ticketId?: string) {
    this.state.viewingTicketId = ticketId
  }

  setTicketViewTab(tab: 'ticket' | 'session') {
    this.state.ticketViewTab = tab
  }

  setSelectedAgentIndex(index: number) {
    this.state.selectedAgentIndex = index
  }

  setSelectedLogIndex(index: number) {
    this.state.selectedLogIndex = index
  }

  setPlanViewActivePane(pane: 'chat' | 'docs') {
    this.state.planViewActivePane = pane
  }

  setPlanViewActiveDoc(doc: 'prd' | 'plan' | 'tickets') {
    this.state.planViewActiveDoc = doc
  }

  setRefineViewActivePane(pane: 'sidebar' | 'chat') {
    this.state.refineViewActivePane = pane
  }

  setRefineViewSelectedTicket(index: number) {
    this.state.refineViewSelectedTicket = index
  }

  // Simulation methods
  updateAgentProgress() {
    for (const agent of this.state.agents) {
      if (agent.status === 'working' && agent.progress < 100) {
        agent.progress = Math.min(100, agent.progress + Math.random() * 5)
      }
    }
  }

  addRandomLogEntry() {
    const levels: LogEntry['level'][] = ['INFO', 'INFO', 'INFO', 'WARN', 'EVENT']
    const agents = ['a1', 'a2', 'a3']
    const actions = [
      'Reading file: src/utils/helpers.ts',
      'Writing file: src/components/Button.tsx',
      'Running tests...',
      'Code review completed',
      'Fixing lint errors',
    ]

    const now = new Date()
    const timestamp = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`

    const newLog: LogEntry = {
      id: `l${this.state.logs.length + 1}`,
      timestamp,
      level: levels[Math.floor(Math.random() * levels.length)],
      agentId: agents[Math.floor(Math.random() * agents.length)],
      ticketNumber: Math.floor(Math.random() * 10) + 35,
      message: actions[Math.floor(Math.random() * actions.length)],
    }

    this.state.logs.unshift(newLog)
    if (this.state.logs.length > 50) {
      this.state.logs.pop()
    }
  }
}
