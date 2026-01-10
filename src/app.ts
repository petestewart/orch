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
import { createKanbanView, getColumnTicketCount, getColumnCount, COLUMNS } from './views/KanbanView.js'
import { createTicketView } from './views/TicketView.js'
import { createSessionView } from './views/SessionView.js'
import { createAgentsView, getAgentCount } from './views/AgentsView.js'
import { createLogsView, getLogCount } from './views/LogsView.js'
import { createPlanView } from './views/PlanView.js'
import { createRefineView } from './views/RefineView.js'
import type { AppState } from './state/types.js'
import { triggerShutdown } from './core/shutdown.js'
import { getEventBus } from './core/events.js'

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

      // Handle help
      if (key.name === '?') {
        this.showHelp()
        return
      }

      // Handle escape
      if (key.name === 'escape') {
        const state = this.store.getState()
        // If viewing a ticket, close the ticket view and return to Kanban
        if (state.currentView === 'kanban' && state.viewingTicketId) {
          this.store.setViewingTicketId(undefined)
          this.renderCurrentView()
          return
        }
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
    this.statusBar = createStatusBar(this.ctx, { currentView: view })
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
        activePane: state.planViewActivePane,
        activeDoc: state.planViewActiveDoc,
        onPaneChange: (pane) => {
          this.store.setPlanViewActivePane(pane)
          this.renderCurrentView()
        },
        onDocChange: (doc) => {
          this.store.setPlanViewActiveDoc(doc)
          this.renderCurrentView()
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

  private handleRefineKeypress(key: { name?: string; ctrl?: boolean; shift?: boolean }) {
    const state = this.store.getState()
    const ticketCount = state.tickets.length
    let needsRerender = false

    // Tab to switch between sidebar and chat
    if (key.name === 'tab') {
      const newPane = state.refineViewActivePane === 'sidebar' ? 'chat' : 'sidebar'
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

    if (needsRerender) {
      this.renderCurrentView()
    }
  }

  private showHelp() {
    // TODO: Implement help overlay
    // For now, just a placeholder
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
