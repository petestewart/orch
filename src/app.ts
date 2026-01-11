import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  type CliRenderer,
  type RenderContext,
  t,
  fg,
  dim,
} from '@opentui/core'
import { Store } from './state/store.js'
import { colors } from './utils/colors.js'
import { createHeader } from './components/Header.js'
import { createTabBar, getViewByNumber, type ViewName } from './components/TabBar.js'
import { createStatusBar } from './components/StatusBar.js'
import { createHelpOverlay } from './components/HelpOverlay.js'
import { createKanbanView, getColumnTicketCount, getColumnCount, COLUMNS } from './views/KanbanView.js'
import { createTicketView } from './views/TicketView.js'
import { createSessionView } from './views/SessionView.js'
import { createAgentsView, getAgentCount } from './views/AgentsView.js'
import { createLogsView, getLogCount } from './views/LogsView.js'
import { createPlanView } from './views/PlanView.js'
import { createRefineView } from './views/RefineView.js'
import type { AppState, AuditFindingUI } from './state/types.js'
import { triggerShutdown } from './core/shutdown.js'
import { getEventBus } from './core/events.js'
import { runPlanAudit, type AuditPhase } from './core/plan-audit.js'
import { PlanStore, type ParsedPlan } from './core/plan-store.js'

export class App {
  private renderer!: CliRenderer
  private store: Store
  private ctx!: RenderContext

  // Layout containers
  private mainContainer!: BoxRenderable
  private header!: BoxRenderable
  private tabBar!: ReturnType<typeof createTabBar>
  private contentArea!: BoxRenderable
  private statusBar!: BoxRenderable

  // Current view reference
  private currentViewComponent: BoxRenderable | null = null

  // Help overlay reference (T019)
  private helpOverlayComponent: BoxRenderable | null = null

  // Cached plan for audit (T038)
  private cachedPlan: ParsedPlan | null = null
  private projectPath: string = process.cwd()

  constructor() {
    this.store = new Store()
  }

  async start() {
    this.renderer = await createCliRenderer({
      exitOnCtrlC: false,
      useAlternateScreen: true,
      useMouse: true,
      backgroundColor: colors.bg,
    })

    this.ctx = this.renderer

    this.setupLayout()
    this.setupKeyboardHandlers()
    this.startSimulation()

    this.renderer.start()
  }

  private setupLayout() {
    const state = this.store.getState()

    // Main container - full screen column layout
    this.mainContainer = new BoxRenderable(this.ctx, {
      width: '100%',
      height: '100%',
      flexDirection: 'column',
      backgroundColor: colors.bg,
    })

    // Header
    const epics = state.epics.filter(e => state.selectedEpicIds.includes(e.id))
    this.header = createHeader(this.ctx, {
      epicNames: epics.map(e => e.name),
      selectedEpicIds: state.selectedEpicIds,
    })

    // Tab bar
    this.tabBar = createTabBar(this.ctx, {
      currentView: state.currentView,
      onViewChange: (view) => this.switchView(view),
    })

    // Content area - takes remaining space
    this.contentArea = new BoxRenderable(this.ctx, {
      flexGrow: 1,
      width: '100%',
      backgroundColor: colors.bg,
      overflow: 'hidden',
    })

    // Status bar
    this.statusBar = createStatusBar(this.ctx, {
      currentView: state.currentView,
      pendingApprovalsCount: this.store.getPendingApprovalsCount(),
      totalCost: this.store.getTotalCost(), // T025: Cost Tracking
    })

    // Add to main container
    this.mainContainer.add(this.header)
    this.mainContainer.add(this.tabBar)
    this.mainContainer.add(this.contentArea)
    this.mainContainer.add(this.statusBar)

    // Add main container to root
    this.renderer.root.add(this.mainContainer)

    // Render initial view
    this.renderCurrentView()
  }

  private setupKeyboardHandlers() {
    this.renderer.keyInput.on('keypress', (key) => {
      const state = this.store.getState()

      // Handle help overlay toggle with '?' (T019)
      if (key.name === '?') {
        this.toggleHelpOverlay()
        return
      }

      // Handle escape - closes help overlay first, then other overlays (T019)
      if (key.name === 'escape') {
        // If help overlay is showing, close it first
        if (state.showHelpOverlay) {
          this.store.hideHelpOverlay()
          this.renderHelpOverlay()
          return
        }

        // If viewing a ticket, close the ticket view and return to Kanban
        if (state.currentView === 'kanban' && state.viewingTicketId) {
          this.store.setViewingTicketId(undefined)
          this.renderCurrentView()
          return
        }
      }

      // If help overlay is showing, don't process other keys
      if (state.showHelpOverlay) {
        return
      }

      // Handle quit
      if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
        this.quit()
        return
      }

      // Handle tab switching with number keys
      if (key.name && /^[1-5]$/.test(key.name)) {
        const view = getViewByNumber(parseInt(key.name, 10))
        if (view) {
          this.switchView(view)
        }
        return
      }

      // Pass to current view for view-specific handling
      this.handleViewKeypress(key)
    })
  }

  private switchView(view: ViewName) {
    const state = this.store.getState()
    if (state.currentView === view) return

    this.store.setCurrentView(view)

    // Update tab bar selection
    const viewIndex = ['plan', 'refine', 'kanban', 'agents', 'logs'].indexOf(view)
    if (viewIndex >= 0) {
      this.tabBar.setSelectedIndex(viewIndex)
    }

    // Update status bar
    this.mainContainer.remove(this.statusBar.id)
    this.statusBar = createStatusBar(this.ctx, {
      currentView: view,
      pendingApprovalsCount: this.store.getPendingApprovalsCount(),
      totalCost: this.store.getTotalCost(), // T025: Cost Tracking
    })
    this.mainContainer.add(this.statusBar)

    // Render new view
    this.renderCurrentView()
  }

  private renderCurrentView() {
    const state = this.store.getState()

    // Remove current view if exists
    if (this.currentViewComponent) {
      this.contentArea.remove(this.currentViewComponent.id)
      this.currentViewComponent = null
    }

    // Create view based on current state
    let viewContent: BoxRenderable

    if (state.currentView === 'kanban') {
      // Check if viewing a specific ticket
      if (state.viewingTicketId) {
        const ticket = this.store.getTicketById(state.viewingTicketId)
        if (ticket) {
          // Render the appropriate view based on active tab
          if (state.ticketViewTab === 'session') {
            const agent = ticket.assignee ? this.store.getAgentById(ticket.assignee) : undefined
            viewContent = createSessionView(this.ctx, {
              agent,
              ticket,
            })
          } else {
            viewContent = createTicketView(this.ctx, {
              ticket,
              epic: this.store.getEpicById(ticket.epicId),
              store: this.store,
              activeTab: state.ticketViewTab,
              onTabChange: (tab) => this.handleTicketTabChange(tab),
            })
          }
        } else {
          // Ticket not found, show Kanban
          viewContent = createKanbanView(this.ctx, {
            store: this.store,
            selectedColumnIndex: state.selectedColumnIndex,
            selectedTicketIndex: state.selectedTicketIndex,
          })
        }
      } else {
        // Not viewing a ticket, show Kanban
        viewContent = createKanbanView(this.ctx, {
          store: this.store,
          selectedColumnIndex: state.selectedColumnIndex,
          selectedTicketIndex: state.selectedTicketIndex,
        })
      }
    } else if (state.currentView === 'agents') {
      viewContent = createAgentsView(this.ctx, {
        store: this.store,
        selectedAgentIndex: state.selectedAgentIndex,
      })
    } else if (state.currentView === 'logs') {
      viewContent = createLogsView(this.ctx, {
        store: this.store,
        selectedLogIndex: state.selectedLogIndex,
      })
    } else if (state.currentView === 'plan') {
      viewContent = createPlanView(this.ctx, {
        store: this.store,
        activePane: state.planViewActivePane,
        activeDoc: state.planViewActiveDoc,
        planContent: this.cachedPlan?.rawContent,
        onPaneChange: (pane) => {
          this.store.setPlanViewActivePane(pane)
          this.renderCurrentView()
        },
        onDocChange: (doc) => {
          this.store.setPlanViewActiveDoc(doc)
          this.renderCurrentView()
        },
        onSendMessage: (content) => {
          this.handlePlanChatMessage(content)
        },
      })
    } else if (state.currentView === 'refine') {
      viewContent = createRefineView(this.ctx, {
        store: this.store,
        selectedTicketIndex: state.refineViewSelectedTicket,
        activePane: state.refineViewActivePane,
      })
    } else {
      viewContent = this.createPlaceholderView(state.currentView)
    }

    this.currentViewComponent = viewContent
    this.contentArea.add(viewContent)
  }

  private createPlaceholderView(view: ViewName): BoxRenderable {
    const container = new BoxRenderable(this.ctx, {
      width: '100%',
      height: '100%',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.bg,
    })

    const viewTitles: Record<ViewName, string> = {
      plan: 'Epic Planning',
      refine: 'Backlog Refinement',
      kanban: 'Kanban Board',
      agents: 'Agent Management',
      logs: 'System Logs',
    }

    const title = new TextRenderable(this.ctx, {
      content: t`${fg(colors.cyan)(viewTitles[view])}`,
    })

    const subtitle = new TextRenderable(this.ctx, {
      content: t`${dim(fg(colors.textDim)('View coming soon...'))}`,
    })

    container.add(title)
    container.add(subtitle)

    return container
  }

  private handleViewKeypress(key: { name?: string; ctrl?: boolean; shift?: boolean }) {
    const state = this.store.getState()

    if (state.currentView === 'kanban') {
      this.handleKanbanKeypress(key)
    } else if (state.currentView === 'agents') {
      this.handleAgentsKeypress(key)
    } else if (state.currentView === 'logs') {
      this.handleLogsKeypress(key)
    } else if (state.currentView === 'plan') {
      this.handlePlanKeypress(key)
    } else if (state.currentView === 'refine') {
      this.handleRefineKeypress(key)
    }
  }

  private handleKanbanKeypress(key: { name?: string; ctrl?: boolean; shift?: boolean }) {
    const state = this.store.getState()
    const { selectedColumnIndex, selectedTicketIndex } = state
    const ticketCount = getColumnTicketCount(this.store, selectedColumnIndex)
    const columnCount = getColumnCount()

    let needsRerender = false

    // Navigate tickets with j/k
    if (key.name === 'j' || key.name === 'down') {
      if (selectedTicketIndex < ticketCount - 1) {
        this.store.setSelectedTicketIndex(selectedTicketIndex + 1)
        needsRerender = true
      }
    } else if (key.name === 'k' || key.name === 'up') {
      if (selectedTicketIndex > 0) {
        this.store.setSelectedTicketIndex(selectedTicketIndex - 1)
        needsRerender = true
      }
    }

    // Navigate columns with h/l or left/right
    if (key.name === 'l' || key.name === 'right') {
      if (selectedColumnIndex < columnCount - 1) {
        this.store.setSelectedColumn(selectedColumnIndex + 1)
        // Reset ticket selection to 0 for new column
        const newTicketCount = getColumnTicketCount(this.store, selectedColumnIndex + 1)
        this.store.setSelectedTicketIndex(Math.min(selectedTicketIndex, Math.max(0, newTicketCount - 1)))
        needsRerender = true
      }
    } else if (key.name === 'h' || key.name === 'left') {
      if (selectedColumnIndex > 0) {
        this.store.setSelectedColumn(selectedColumnIndex - 1)
        // Reset ticket selection to 0 for new column
        const newTicketCount = getColumnTicketCount(this.store, selectedColumnIndex - 1)
        this.store.setSelectedTicketIndex(Math.min(selectedTicketIndex, Math.max(0, newTicketCount - 1)))
        needsRerender = true
      }
    }

    // Enter to open ticket detail
    if (key.name === 'return') {
      if (selectedColumnIndex >= 0 && selectedColumnIndex < COLUMNS.length) {
        const tickets = this.store.getTicketsByStatus(COLUMNS[selectedColumnIndex].status)
        if (selectedTicketIndex < tickets.length) {
          const selectedTicket = tickets[selectedTicketIndex]
          this.store.setViewingTicketId(selectedTicket.id)
          this.store.setTicketViewTab('ticket')
          this.renderCurrentView()
        }
      }
      return
    }

    // 's' key starts agent on selected ticket (if ready)
    if (key.name === 's') {
      if (selectedColumnIndex >= 0 && selectedColumnIndex < COLUMNS.length) {
        const tickets = this.store.getTicketsByStatus(COLUMNS[selectedColumnIndex].status)
        if (selectedTicketIndex < tickets.length) {
          const selectedTicket = tickets[selectedTicketIndex]
          // Only start agents on ready backlog tickets
          if (selectedTicket.status === 'backlog' && selectedTicket.ready) {
            const eventBus = getEventBus()
            // Emit event for orchestrator to handle
            eventBus.publish({
              type: 'ticket:assigned',
              timestamp: new Date(),
            })
            // Log the action
            eventBus.publish({
              type: 'log:entry',
              timestamp: new Date(),
              level: 'info',
              message: `Starting agent on ticket ${selectedTicket.id.toUpperCase()}: ${selectedTicket.title}`,
              ticketId: selectedTicket.id.toUpperCase(),
            })
          } else if (selectedTicket.status === 'backlog' && !selectedTicket.ready) {
            // Ticket not ready - log warning
            const eventBus = getEventBus()
            eventBus.publish({
              type: 'log:entry',
              timestamp: new Date(),
              level: 'warn',
              message: `Cannot start agent on ticket ${selectedTicket.id.toUpperCase()}: ticket has unmet dependencies`,
              ticketId: selectedTicket.id.toUpperCase(),
            })
          }
        }
      }
      return
    }

    // 'e' key cycles through epic filter (T034)
    if (key.name === 'e') {
      this.store.cycleKanbanEpicFilter()
      this.renderCurrentView()
      return
    }

    // Human intervention keys (T029) - context-sensitive based on selection
    // 'a' key approves and advances ticket
    if (key.name === 'a') {
      if (selectedColumnIndex >= 0 && selectedColumnIndex < COLUMNS.length) {
        const tickets = this.store.getTicketsByStatus(COLUMNS[selectedColumnIndex].status)
        if (selectedTicketIndex < tickets.length) {
          const selectedTicket = tickets[selectedTicketIndex]
          // Only approve tickets in review or qa status
          if (selectedTicket.status === 'review' || selectedTicket.status === 'qa') {
            this.store.requestApproveTicket(selectedTicket.id)
            needsRerender = true
          }
        }
      }
    }

    // 'r' key rejects ticket (for review/qa status)
    if (key.name === 'r') {
      if (selectedColumnIndex >= 0 && selectedColumnIndex < COLUMNS.length) {
        const tickets = this.store.getTicketsByStatus(COLUMNS[selectedColumnIndex].status)
        if (selectedTicketIndex < tickets.length) {
          const selectedTicket = tickets[selectedTicketIndex]
          // Reject for review or qa status
          if (selectedTicket.status === 'review' || selectedTicket.status === 'qa') {
            // Show confirmation dialog for destructive action
            this.store.showConfirmationDialog({
              title: 'Reject Ticket',
              message: `Are you sure you want to reject ticket #${selectedTicket.number}? It will return to the backlog.`,
              confirmLabel: 'Reject',
              cancelLabel: 'Cancel',
              onConfirm: () => {
                this.store.requestRejectTicket(selectedTicket.id, 'Manual rejection from UI')
                this.store.closeConfirmationDialog()
                this.renderCurrentView()
              },
              onCancel: () => {
                this.store.closeConfirmationDialog()
                this.renderCurrentView()
              },
            })
            needsRerender = true
          }
        }
      }
    }

    // 't' key takes over (switches to manual mode)
    if (key.name === 't') {
      if (selectedColumnIndex >= 0 && selectedColumnIndex < COLUMNS.length) {
        const tickets = this.store.getTicketsByStatus(COLUMNS[selectedColumnIndex].status)
        if (selectedTicketIndex < tickets.length) {
          const selectedTicket = tickets[selectedTicketIndex]
          // Can take over tickets in review, qa, or in_progress
          if (selectedTicket.status === 'review' || selectedTicket.status === 'qa' || selectedTicket.status === 'in_progress') {
            this.store.requestTakeoverTicket(selectedTicket.id)
            needsRerender = true
          }
        }
      }
    }

    // 'p' key pauses/resumes automation for this ticket
    if (key.name === 'p') {
      if (selectedColumnIndex >= 0 && selectedColumnIndex < COLUMNS.length) {
        const tickets = this.store.getTicketsByStatus(COLUMNS[selectedColumnIndex].status)
        if (selectedTicketIndex < tickets.length) {
          const selectedTicket = tickets[selectedTicketIndex]
          // Can pause any ticket that isn't done
          if (selectedTicket.status !== 'done') {
            this.store.requestPauseTicket(selectedTicket.id)
            needsRerender = true
          }
        }
      }
    }

    if (needsRerender) {
      this.renderCurrentView()
    }
  }

  private handleTicketTabChange(tab: 'ticket' | 'session') {
    this.store.setTicketViewTab(tab)
    this.renderCurrentView()
  }

  private handleAgentsKeypress(key: { name?: string; ctrl?: boolean; shift?: boolean }) {
    const state = this.store.getState()
    const agentCount = getAgentCount(this.store)
    let needsRerender = false

    // Navigate agents with j/k
    if (key.name === 'j' || key.name === 'down') {
      if (state.selectedAgentIndex < agentCount - 1) {
        this.store.setSelectedAgentIndex(state.selectedAgentIndex + 1)
        needsRerender = true
      }
    } else if (key.name === 'k' || key.name === 'up') {
      if (state.selectedAgentIndex > 0) {
        this.store.setSelectedAgentIndex(state.selectedAgentIndex - 1)
        needsRerender = true
      }
    }

    // Stop selected agent with 'x' key
    if (key.name === 'x') {
      const agents = state.agents
      if (agents.length > 0 && state.selectedAgentIndex < agents.length) {
        const selectedAgent = agents[state.selectedAgentIndex]
        // Only allow stopping agents that are currently working or waiting
        if (selectedAgent.status === 'working' || selectedAgent.status === 'waiting') {
          this.store.requestStopAgent(selectedAgent.id)
          needsRerender = true
        }
      }
    }

    if (needsRerender) {
      this.renderCurrentView()
    }
  }

  private handleLogsKeypress(key: { name?: string; ctrl?: boolean; shift?: boolean }) {
    const state = this.store.getState()
    const logCount = getLogCount(this.store)
    let needsRerender = false

    // Navigate logs with j/k
    if (key.name === 'j' || key.name === 'down') {
      if (state.selectedLogIndex < logCount - 1) {
        this.store.setSelectedLogIndex(state.selectedLogIndex + 1)
        needsRerender = true
      }
    } else if (key.name === 'k' || key.name === 'up') {
      if (state.selectedLogIndex > 0) {
        this.store.setSelectedLogIndex(state.selectedLogIndex - 1)
        needsRerender = true
      }
    }

    // Filter controls
    // 'l' - cycle level filter (ALL -> INFO -> WARN -> ERROR -> EVENT -> ALL)
    if (key.name === 'l') {
      this.store.cycleLevelFilter()
      needsRerender = true
    }

    // 'a' - cycle agent filter (ALL -> agent1 -> agent2 -> ... -> ALL)
    if (key.name === 'a') {
      this.store.cycleAgentFilter()
      needsRerender = true
    }

    // 't' - cycle ticket filter (ALL -> T001 -> T002 -> ... -> ALL)
    if (key.name === 't') {
      this.store.cycleTicketFilter()
      needsRerender = true
    }

    // 's' - toggle auto-scroll
    if (key.name === 's') {
      this.store.toggleLogsAutoScroll()
      needsRerender = true
    }

    // 'c' - clear all filters
    if (key.name === 'c') {
      this.store.setLogsLevelFilter(undefined)
      this.store.setLogsAgentFilter(undefined)
      this.store.setLogsTicketFilter(undefined)
      this.store.setLogsSearchQuery(undefined)
      needsRerender = true
    }

    if (needsRerender) {
      this.renderCurrentView()
    }
  }

  private handlePlanKeypress(key: { name?: string; ctrl?: boolean; shift?: boolean }) {
    const state = this.store.getState()
    let needsRerender = false

    // Tab to switch between chat and docs pane
    if (key.name === 'tab') {
      const newPane = state.planViewActivePane === 'chat' ? 'docs' : 'chat'
      this.store.setPlanViewActivePane(newPane)
      needsRerender = true
    }

    // When in docs pane, switch documents with h/l
    if (state.planViewActivePane === 'docs') {
      const docs: Array<'prd' | 'plan' | 'tickets'> = ['prd', 'plan', 'tickets']
      const currentIndex = docs.indexOf(state.planViewActiveDoc)

      if (key.name === 'l' || key.name === 'right') {
        if (currentIndex < docs.length - 1) {
          this.store.setPlanViewActiveDoc(docs[currentIndex + 1])
          needsRerender = true
        }
      } else if (key.name === 'h' || key.name === 'left') {
        if (currentIndex > 0) {
          this.store.setPlanViewActiveDoc(docs[currentIndex - 1])
          needsRerender = true
        }
      }
    }

    if (needsRerender) {
      this.renderCurrentView()
    }
  }

  /**
   * Handle chat messages in Plan View (T020)
   * For now, generates mock AI responses. Real AI integration is a future ticket.
   */
  private handlePlanChatMessage(content: string): void {
    // Add user message to store
    this.store.addPlanViewUserMessage(content)
    this.renderCurrentView()

    // Generate mock AI response after a small delay
    setTimeout(() => {
      const response = this.generateMockPlanResponse(content)
      this.store.addPlanViewAIMessage(response)
      this.renderCurrentView()
    }, 500)
  }

  /**
   * Generate a mock AI response for Plan View (T020)
   * This will be replaced with real AI integration in a future ticket.
   */
  private generateMockPlanResponse(userMessage: string): string {
    const lowerMessage = userMessage.toLowerCase()

    // Check for common planning-related keywords and generate contextual responses
    if (lowerMessage.includes('create') || lowerMessage.includes('add') || lowerMessage.includes('new ticket')) {
      return `I can help you create a new ticket. Here's what I would add to PLAN.md:

### Ticket: TXXX [Your Title Here]
- **Priority:** P1
- **Status:** Todo
- **Owner:** Unassigned
- **Scope:** [Description of what this ticket accomplishes]
- **Acceptance Criteria:**
  - [Criterion 1]
  - [Criterion 2]
- **Validation Steps:**
  - [Test command or verification step]

Would you like me to create this ticket with specific details?`
    }

    if (lowerMessage.includes('dependency') || lowerMessage.includes('dependencies') || lowerMessage.includes('blocked')) {
      const state = this.store.getState()
      const blockedTickets = state.tickets.filter(t => t.blockedBy.length > 0)
      if (blockedTickets.length > 0) {
        const blockedList = blockedTickets.slice(0, 3).map(t =>
          `- ${t.id.toUpperCase()}: ${t.title} (blocked by: ${t.blockedBy.map(b => b.toUpperCase()).join(', ')})`
        ).join('\n')
        return `Here are tickets with dependencies:\n\n${blockedList}\n\nWould you like me to analyze the dependency chain or suggest reordering?`
      }
      return 'Currently there are no tickets with dependencies. Would you like me to help you define dependencies between existing tickets?'
    }

    if (lowerMessage.includes('status') || lowerMessage.includes('progress')) {
      const state = this.store.getState()
      const statusCounts: Record<string, number> = {}
      state.tickets.forEach(t => {
        statusCounts[t.status] = (statusCounts[t.status] || 0) + 1
      })
      const summary = Object.entries(statusCounts)
        .map(([status, count]) => `${status}: ${count}`)
        .join(', ')
      return `Current project status:\n\n${summary}\n\nTotal tickets: ${state.tickets.length}\n\nWould you like more details on any specific status?`
    }

    if (lowerMessage.includes('priorit') || lowerMessage.includes('p0') || lowerMessage.includes('p1') || lowerMessage.includes('p2')) {
      return `I can help you manage ticket priorities. The priority levels are:

- **P0:** Critical - Must be done immediately
- **P1:** High - Important for the current milestone
- **P2:** Medium - Should be done but can wait

Would you like me to:
1. List tickets by priority
2. Suggest priority changes
3. Help you reprioritize the backlog`
    }

    if (lowerMessage.includes('help') || lowerMessage.includes('what can you do')) {
      return `I can help you with project planning tasks:

**Creating & Editing:**
- Create new tickets with acceptance criteria
- Modify existing ticket details
- Add or update dependencies

**Analysis:**
- Analyze the dependency graph
- Identify blocked tickets
- Suggest priority adjustments

**Reporting:**
- Summarize project status
- List tickets by status or priority
- Show upcoming work

What would you like to work on?`
    }

    // Default response
    return `I understand you're asking about: "${userMessage}"

As a planning assistant, I can help you:
- Create or modify tickets
- Analyze dependencies
- Review project status

Could you please provide more details about what you'd like to accomplish?`
  }

  private handleRefineKeypress(key: { name?: string; ctrl?: boolean; shift?: boolean }) {
    const state = this.store.getState()
    const ticketCount = state.tickets.length
    let needsRerender = false

    // 'A' key (uppercase/Shift+A) triggers plan audit (T038)
    if (key.name === 'a' && key.shift) {
      this.triggerPlanAudit()
      return
    }

    // Escape closes audit panel
    if (key.name === 'escape' && state.refineViewActivePane === 'audit') {
      this.store.clearAudit()
      needsRerender = true
    }

    // Tab to switch between sidebar, chat, and audit (if audit results present)
    if (key.name === 'tab') {
      const hasAudit = state.auditFindings.length > 0 || state.auditInProgress
      let newPane: 'sidebar' | 'chat' | 'audit'

      if (hasAudit) {
        // Cycle: sidebar -> chat -> audit -> sidebar
        if (state.refineViewActivePane === 'sidebar') {
          newPane = 'chat'
        } else if (state.refineViewActivePane === 'chat') {
          newPane = 'audit'
        } else {
          newPane = 'sidebar'
        }
      } else {
        // No audit results, just toggle sidebar/chat
        newPane = state.refineViewActivePane === 'sidebar' ? 'chat' : 'sidebar'
      }
      this.store.setRefineViewActivePane(newPane)
      needsRerender = true
    }

    // When in sidebar, navigate tickets with j/k
    if (state.refineViewActivePane === 'sidebar') {
      if (key.name === 'j' || key.name === 'down') {
        if (state.refineViewSelectedTicket < ticketCount - 1) {
          this.store.setRefineViewSelectedTicket(state.refineViewSelectedTicket + 1)
          needsRerender = true
        }
      } else if (key.name === 'k' || key.name === 'up') {
        if (state.refineViewSelectedTicket > 0) {
          this.store.setRefineViewSelectedTicket(state.refineViewSelectedTicket - 1)
          needsRerender = true
        }
      }
    }

    // When in audit pane, navigate findings with j/k
    if (state.refineViewActivePane === 'audit') {
      if (key.name === 'j' || key.name === 'down') {
        this.store.nextAuditFinding()
        needsRerender = true
      } else if (key.name === 'k' || key.name === 'up') {
        this.store.prevAuditFinding()
        needsRerender = true
      }
    }

    if (needsRerender) {
      this.renderCurrentView()
    }
  }

  /**
   * Trigger plan audit (T038)
   */
  private async triggerPlanAudit(): Promise<void> {
    const state = this.store.getState()

    // Don't run if already in progress
    if (state.auditInProgress) {
      return
    }

    // Start audit
    this.store.startAudit()
    this.renderCurrentView()

    try {
      // Load the plan if not cached
      if (!this.cachedPlan) {
        const planStore = new PlanStore(`${this.projectPath}/PLAN.md`)
        this.cachedPlan = await planStore.load()
      }

      // Run the audit with progress callback
      const result = await runPlanAudit({
        projectPath: this.projectPath,
        plan: this.cachedPlan!,
        onProgress: (phase: AuditPhase, progress: number) => {
          this.store.setAuditProgress(phase, progress)
          this.renderCurrentView()
        },
      })

      // Convert findings to UI format
      const uiFindings: AuditFindingUI[] = result.findings.map((f, index) => ({
        id: `audit-${index}`,
        severity: f.severity,
        category: f.category,
        message: f.message,
        ticketId: f.ticketId,
        suggestedAction: f.suggestedAction,
        suggestedTicketTitle: f.suggestedTicket?.title,
      }))

      // Complete the audit
      this.store.completeAudit(uiFindings, result.summary)
      this.renderCurrentView()
    } catch (error) {
      // Handle error
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      this.store.completeAudit(
        [{
          id: 'audit-error',
          severity: 'error',
          category: 'audit',
          message: `Audit failed: ${errorMessage}`,
          suggestedAction: 'review',
        }],
        { errors: 1, warnings: 0, infos: 0 }
      )
      this.renderCurrentView()
    }
  }

  /**
   * Toggle the help overlay visibility (T019)
   */
  private toggleHelpOverlay() {
    this.store.toggleHelpOverlay()
    this.renderHelpOverlay()
  }

  /**
   * Render or remove the help overlay based on state (T019)
   */
  private renderHelpOverlay() {
    const state = this.store.getState()

    // Remove existing overlay if present
    if (this.helpOverlayComponent) {
      this.renderer.root.remove(this.helpOverlayComponent.id)
      this.helpOverlayComponent = null
    }

    // Add new overlay if needed
    if (state.showHelpOverlay) {
      this.helpOverlayComponent = createHelpOverlay(this.ctx, {
        currentView: state.currentView,
      })
      this.renderer.root.add(this.helpOverlayComponent)
    }
  }

  private startSimulation() {
    // Register onChange callback to trigger UI re-renders
    // when state changes from events (plan:loaded, agent:progress, etc.)
    this.store.onChange(() => {
      this.renderer.requestRender()
    })
  }

  private async quit() {
    // Destroy the renderer first to restore terminal
    this.renderer.destroy()

    // Trigger graceful shutdown (stops agents, shows summary, exits)
    await triggerShutdown()
  }
}
