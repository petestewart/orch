import {
  BoxRenderable,
  TextRenderable,
  ScrollBoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  t,
  fg,
  bold,
  dim,
  type RenderContext,
} from '@opentui/core'
import { colors } from '../utils/colors.js'
import { createChatPanel } from '../components/ChatPanel.js'
import type { Store } from '../state/store.js'
import type { ChatMessage, Ticket, AuditFindingUI, TicketProposalUI } from '../state/types.js'

export interface RefineViewProps {
  store: Store
  selectedTicketIndex: number
  activePane: 'sidebar' | 'chat' | 'audit'
  /** T036: Callback when user sends a message in the chat */
  onSendMessage?: (content: string) => void
}

export function createRefineView(ctx: RenderContext, props: RefineViewProps): BoxRenderable {
  const { store, selectedTicketIndex, activePane, onSendMessage } = props
  const state = store.getState()
  const tickets = state.tickets

  // Check if we should show audit findings
  const showAudit = state.auditFindings.length > 0 || state.auditInProgress

  // Main container - horizontal layout
  // ┌─ Tickets (20%) ──┬─ Detail (40%) ──────┬─ Chat (40%) ──────────────┐
  // │ ● #42 OAuth flow │ Ticket #42          │ Refine this ticket...     │
  // │   #43 Token ref  │ Status: Backlog     │                           │
  // │   #44 Webhook    │ Priority: P1        │ [AI suggestions]          │
  // │   #45 Rate limit │ Acceptance:         │                           │
  // │                  │ - AC 1              │                           │
  // │                  │ - AC 2              │                           │
  // │                  │                     │ [input field]             │
  // └──────────────────┴─────────────────────┴───────────────────────────┘

  const container = new BoxRenderable(ctx, {
    width: '100%',
    height: '100%',
    flexDirection: 'row',
    backgroundColor: colors.bg,
    gap: 1,
    padding: 0,
  })

  // Left sidebar - ticket list (20%)
  const sidebar = new BoxRenderable(ctx, {
    width: '20%',
    height: '100%',
    flexDirection: 'column',
    border: true,
    borderStyle: 'single',
    borderColor: activePane === 'sidebar' ? colors.cyan : colors.border,
    backgroundColor: colors.bgDark,
    padding: 1,
    gap: 1,
  })

  // Sidebar header
  const sidebarHeader = new TextRenderable(ctx, {
    content: t`${bold(fg(colors.cyan)('Tickets'))}`,
  })
  sidebar.add(sidebarHeader)

  // Ticket scroll area
  const ticketScrollArea = new ScrollBoxRenderable(ctx, {
    width: '100%',
    flexGrow: 1,
    flexDirection: 'column',
    gap: 0,
    backgroundColor: colors.bgDark,
    padding: 0,
  })

  // Add tickets to the scroll area
  tickets.forEach((ticket, index) => {
    const isSelected = index === selectedTicketIndex

    const ticketItem = new BoxRenderable(ctx, {
      width: '100%',
      flexDirection: 'row',
      gap: 1,
      paddingLeft: 1,
      paddingRight: 1,
      paddingTop: 0,
      paddingBottom: 0,
      backgroundColor: isSelected ? colors.selectedBg : 'transparent',
      marginBottom: 0,
    })

    // Selection indicator
    const indicator = new TextRenderable(ctx, {
      content: t`${fg(isSelected ? colors.yellow : colors.textMuted)(isSelected ? '>' : ' ')}`,
    })
    ticketItem.add(indicator)

    // Status indicator
    const statusColor = getStatusColor(ticket.status)
    const statusIndicator = new TextRenderable(ctx, {
      content: t`${fg(statusColor)('●')}`,
    })
    ticketItem.add(statusIndicator)

    // Ticket number and title (truncate title if too long)
    const maxTitleLen = 15
    const displayTitle = ticket.title.length > maxTitleLen
      ? ticket.title.substring(0, maxTitleLen - 1) + '...'
      : ticket.title
    const ticketText = new TextRenderable(ctx, {
      content: t`${fg(colors.cyan)(`T${String(ticket.number).padStart(3, '0')}`)} ${fg(isSelected ? colors.text : colors.textMuted)(displayTitle)}`,
    })
    ticketItem.add(ticketText)

    ticketScrollArea.add(ticketItem)
  })

  // Empty state if no tickets
  if (tickets.length === 0) {
    const emptyText = new TextRenderable(ctx, {
      content: t`${dim(fg(colors.textMuted)('No tickets'))}`,
    })
    ticketScrollArea.add(emptyText)
  }

  sidebar.add(ticketScrollArea)

  // Sidebar footer with help text
  const sidebarFooter = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textMuted)('j/k nav  Tab switch'))}`,
  })
  sidebar.add(sidebarFooter)

  container.add(sidebar)

  // Right panel - audit findings or ticket detail + chat
  if (showAudit) {
    // Show audit findings panel (full width of right side)
    const rightPanel = new BoxRenderable(ctx, {
      width: '80%',
      height: '100%',
      flexDirection: 'column',
      gap: 1,
    })

    const auditPanel = createAuditPanel(ctx, {
      findings: state.auditFindings,
      selectedIndex: state.selectedAuditFindingIndex,
      inProgress: state.auditInProgress,
      phase: state.auditPhase,
      progress: state.auditProgress,
      summary: state.auditSummary,
      isActive: activePane === 'audit',
    })
    rightPanel.add(auditPanel)
    container.add(rightPanel)
  } else {
    // Get the selected ticket
    const selectedTicket = tickets[selectedTicketIndex]

    // Middle panel - ticket detail (40%)
    const detailPanel = createTicketDetailPanel(ctx, {
      ticket: selectedTicket,
      store,
    })
    container.add(detailPanel)

    // Right panel - chat (40%)
    const chatContainer = new BoxRenderable(ctx, {
      width: '40%',
      height: '100%',
      flexDirection: 'column',
      gap: 0,
    })

    // Use store's chat messages for ticket creation (T035)
    const chatMessages = state.refineViewChatMessages
    const proposals = state.ticketProposals
    const selectedProposalIndex = state.selectedProposalIndex

    // Wrap chat panel with active border indicator
    const chatWrapper = new BoxRenderable(ctx, {
      width: '100%',
      height: '100%',
      flexDirection: 'column',
      border: true,
      borderStyle: 'single',
      borderColor: activePane === 'chat' ? colors.cyan : colors.border,
      backgroundColor: colors.bgDark,
      padding: 0,
    })

    // Create chat panel with proposals support (T035, T036)
    const chatPanel = createTicketCreationChat(ctx, {
      messages: chatMessages,
      proposals,
      selectedProposalIndex,
      isActive: activePane === 'chat',
      onSendMessage, // T036: Connect to Refine Agent
    })
    chatWrapper.add(chatPanel)
    chatContainer.add(chatWrapper)

    // Chat footer with hints - show different hints based on state
    const hasProposals = proposals.length > 0
    const footerHint = hasProposals
      ? 'j/k: nav  Space: select  c: create  e: edit  Shift+A: audit'
      : 'Type to describe a task  Shift+A: audit plan'
    const chatFooter = new TextRenderable(ctx, {
      content: t`${dim(fg(colors.textMuted)(footerHint))}`,
    })
    chatContainer.add(chatFooter)

    container.add(chatContainer)
  }

  return container
}

/**
 * Get color for ticket status
 */
function getStatusColor(status: string): string {
  switch (status) {
    case 'done': return colors.green
    case 'in_progress': return colors.yellow
    case 'review': return colors.cyan
    case 'qa': return colors.magenta
    case 'backlog': return colors.textMuted
    default: return colors.textMuted
  }
}

/**
 * Props for ticket detail panel
 */
interface TicketDetailPanelProps {
  ticket?: Ticket
  store: Store
}

/**
 * Create a ticket detail panel for the refine view
 */
function createTicketDetailPanel(ctx: RenderContext, props: TicketDetailPanelProps): BoxRenderable {
  const { ticket, store } = props

  const panel = new BoxRenderable(ctx, {
    width: '40%',
    height: '100%',
    flexDirection: 'column',
    border: true,
    borderStyle: 'single',
    borderColor: colors.border,
    backgroundColor: colors.bgDark,
    padding: 1,
    gap: 1,
  })

  if (!ticket) {
    const emptyText = new TextRenderable(ctx, {
      content: t`${dim(fg(colors.textMuted)('Select a ticket to view details'))}`,
    })
    panel.add(emptyText)
    return panel
  }

  // Header with ticket ID and title
  const header = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'column',
    gap: 0,
    marginBottom: 1,
  })

  const ticketId = new TextRenderable(ctx, {
    content: t`${bold(fg(colors.cyan)(`Ticket T${String(ticket.number).padStart(3, '0')}`))}`,
  })
  header.add(ticketId)

  const ticketTitle = new TextRenderable(ctx, {
    content: t`${fg(colors.text)(ticket.title)}`,
  })
  header.add(ticketTitle)

  panel.add(header)

  // Metadata section
  const metaSection = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'column',
    gap: 0,
    marginBottom: 1,
  })

  // Status row
  const statusRow = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'row',
    gap: 1,
  })
  const statusLabel = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textDim)('Status:'))}`,
  })
  statusRow.add(statusLabel)
  const statusValue = new TextRenderable(ctx, {
    content: t`${fg(getStatusColor(ticket.status))(ticket.status)}`,
  })
  statusRow.add(statusValue)
  metaSection.add(statusRow)

  // Priority row
  const priorityRow = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'row',
    gap: 1,
  })
  const priorityLabel = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textDim)('Priority:'))}`,
  })
  priorityRow.add(priorityLabel)
  const priorityColor = ticket.priority === 'P1' ? colors.red : ticket.priority === 'P2' ? colors.yellow : colors.textMuted
  const priorityValue = new TextRenderable(ctx, {
    content: t`${fg(priorityColor)(ticket.priority)}`,
  })
  priorityRow.add(priorityValue)
  metaSection.add(priorityRow)

  // Epic row (if available)
  if (ticket.epicId) {
    const epic = store.getEpicById(ticket.epicId)
    const epicRow = new BoxRenderable(ctx, {
      width: '100%',
      flexDirection: 'row',
      gap: 1,
    })
    const epicLabel = new TextRenderable(ctx, {
      content: t`${dim(fg(colors.textDim)('Epic:'))}`,
    })
    epicRow.add(epicLabel)
    const epicValue = new TextRenderable(ctx, {
      content: t`${fg(colors.text)(epic?.name || ticket.epicId)}`,
    })
    epicRow.add(epicValue)
    metaSection.add(epicRow)
  }

  // Ready status
  const readyRow = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'row',
    gap: 1,
  })
  const readyLabel = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textDim)('Ready:'))}`,
  })
  readyRow.add(readyLabel)
  const readyValue = new TextRenderable(ctx, {
    content: ticket.ready
      ? t`${fg(colors.green)('Yes')}`
      : t`${fg(colors.red)('No')} ${dim(fg(colors.textMuted)(`(blocked by ${ticket.blockedBy.length} tickets)`))}`,
  })
  readyRow.add(readyValue)
  metaSection.add(readyRow)

  panel.add(metaSection)

  // Description section (if available)
  if (ticket.description) {
    const descSection = new BoxRenderable(ctx, {
      width: '100%',
      flexDirection: 'column',
      gap: 0,
      marginBottom: 1,
    })
    const descLabel = new TextRenderable(ctx, {
      content: t`${bold(fg(colors.textDim)('Description'))}`,
    })
    descSection.add(descLabel)
    const descText = new TextRenderable(ctx, {
      content: t`${fg(colors.text)(ticket.description)}`,
    })
    descSection.add(descText)
    panel.add(descSection)
  }

  // Acceptance Criteria section
  const acSection = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'column',
    gap: 0,
  })
  const acLabel = new TextRenderable(ctx, {
    content: t`${bold(fg(colors.textDim)('Acceptance Criteria'))}`,
  })
  acSection.add(acLabel)

  if (ticket.acceptanceCriteria.length > 0) {
    const acScroll = new ScrollBoxRenderable(ctx, {
      width: '100%',
      flexGrow: 1,
      flexDirection: 'column',
      gap: 0,
      backgroundColor: colors.bgDark,
      padding: 0,
    })

    ticket.acceptanceCriteria.forEach((criterion, index) => {
      const acRow = new BoxRenderable(ctx, {
        width: '100%',
        flexDirection: 'row',
        gap: 1,
      })
      const bullet = new TextRenderable(ctx, {
        content: t`${fg(colors.textMuted)('•')}`,
      })
      acRow.add(bullet)
      const acText = new TextRenderable(ctx, {
        content: t`${fg(colors.text)(criterion)}`,
      })
      acRow.add(acText)
      acScroll.add(acRow)
    })
    acSection.add(acScroll)
  } else {
    const noAc = new TextRenderable(ctx, {
      content: t`${dim(fg(colors.textMuted)('No acceptance criteria defined'))}`,
    })
    acSection.add(noAc)
  }

  panel.add(acSection)

  // Dependencies section (if any)
  if (ticket.blockedBy.length > 0) {
    const depsSection = new BoxRenderable(ctx, {
      width: '100%',
      flexDirection: 'column',
      gap: 0,
      marginTop: 1,
    })
    const depsLabel = new TextRenderable(ctx, {
      content: t`${bold(fg(colors.textDim)('Blocked By'))}`,
    })
    depsSection.add(depsLabel)

    ticket.blockedBy.forEach(depId => {
      const depTicket = store.getTicketById(depId)
      const depRow = new BoxRenderable(ctx, {
        width: '100%',
        flexDirection: 'row',
        gap: 1,
      })
      const depIdText = new TextRenderable(ctx, {
        content: t`${fg(colors.cyan)(depId.toUpperCase())}`,
      })
      depRow.add(depIdText)
      if (depTicket) {
        const depStatus = new TextRenderable(ctx, {
          content: t`${fg(getStatusColor(depTicket.status))(`(${depTicket.status})`)}`,
        })
        depRow.add(depStatus)
      }
      depsSection.add(depRow)
    })

    panel.add(depsSection)
  }

  return panel
}

/**
 * Inner chat panel without border (for wrapping with active state border)
 */
function createChatPanelInner(ctx: RenderContext, props: { messages: ChatMessage[], onSendMessage?: (content: string) => void, placeholder: string }): BoxRenderable {
  const { messages, placeholder } = props

  const container = new BoxRenderable(ctx, {
    width: '100%',
    height: '100%',
    flexDirection: 'column',
    backgroundColor: colors.bgDark,
    padding: 1,
    gap: 1,
  })

  // Header
  const header = new TextRenderable(ctx, {
    content: t`${bold(fg(colors.cyan)('Refine Ticket'))}`,
  })
  container.add(header)

  // Message scroll area
  const messageArea = new ScrollBoxRenderable(ctx, {
    width: '100%',
    flexGrow: 1,
    flexDirection: 'column',
    gap: 1,
    backgroundColor: colors.bgDark,
    padding: 0,
  })

  // Add messages to the scroll area
  messages.forEach((message) => {
    const messageBox = new BoxRenderable(ctx, {
      width: '100%',
      flexDirection: 'column',
      gap: 0,
      marginBottom: 1,
    })

    // Role label with color coding
    const roleColor = message.role === 'user' ? colors.cyan : colors.green
    const roleLabel = new TextRenderable(ctx, {
      content: t`${fg(roleColor)(message.role === 'user' ? 'You' : 'Assistant')}:`,
    })
    messageBox.add(roleLabel)

    // Message content
    const contentColor = message.role === 'user' ? colors.text : colors.textMuted
    const contentText = new TextRenderable(ctx, {
      content: t`${fg(contentColor)(message.content)}`,
    })
    messageBox.add(contentText)

    messageArea.add(messageBox)
  })

  // Empty state if no messages
  if (messages.length === 0) {
    const emptyText = new TextRenderable(ctx, {
      content: t`${dim(fg(colors.textMuted)('AI suggestions will appear here'))}`,
    })
    messageArea.add(emptyText)
  }

  container.add(messageArea)

  // Input hint (mock - real input in T036)
  const inputHint = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textMuted)('[AI integration in T036]'))}`,
  })
  container.add(inputHint)

  return container
}

/**
 * Props for ticket creation chat panel (T035, T036)
 */
interface TicketCreationChatProps {
  messages: ChatMessage[]
  proposals: TicketProposalUI[]
  selectedProposalIndex: number
  isActive: boolean
  /** T036: Callback when user sends a message */
  onSendMessage?: (content: string) => void
}

/**
 * Create a chat panel for AI-assisted ticket creation (T035, T036)
 */
function createTicketCreationChat(ctx: RenderContext, props: TicketCreationChatProps): BoxRenderable {
  const { messages, proposals, selectedProposalIndex, isActive, onSendMessage } = props

  const container = new BoxRenderable(ctx, {
    width: '100%',
    height: '100%',
    flexDirection: 'column',
    backgroundColor: colors.bgDark,
    padding: 1,
    gap: 1,
  })

  // Header
  const header = new TextRenderable(ctx, {
    content: t`${bold(fg(colors.cyan)('Create Ticket'))}`,
  })
  container.add(header)

  // Content scroll area
  const contentArea = new ScrollBoxRenderable(ctx, {
    width: '100%',
    flexGrow: 1,
    flexDirection: 'column',
    gap: 1,
    backgroundColor: colors.bgDark,
    padding: 0,
  })

  // Show chat messages
  messages.forEach((message) => {
    const messageBox = new BoxRenderable(ctx, {
      width: '100%',
      flexDirection: 'column',
      gap: 0,
      marginBottom: 1,
    })

    // Role label with color coding
    const roleColor = message.role === 'user' ? colors.cyan : colors.green
    const roleLabel = new TextRenderable(ctx, {
      content: t`${fg(roleColor)(message.role === 'user' ? 'You' : 'Assistant')}:`,
    })
    messageBox.add(roleLabel)

    // Message content (truncate long messages)
    const contentColor = message.role === 'user' ? colors.text : colors.textMuted
    const displayContent = message.content.length > 200
      ? message.content.slice(0, 197) + '...'
      : message.content
    const contentText = new TextRenderable(ctx, {
      content: t`${fg(contentColor)(displayContent)}`,
    })
    messageBox.add(contentText)

    contentArea.add(messageBox)
  })

  // Show proposals if any
  if (proposals.length > 0) {
    // Proposals header
    const proposalsHeader = new BoxRenderable(ctx, {
      width: '100%',
      flexDirection: 'row',
      gap: 1,
      marginTop: 1,
    })
    const proposalsTitle = new TextRenderable(ctx, {
      content: t`${bold(fg(colors.yellow)('Proposed Tickets'))} ${dim(fg(colors.textMuted)(`(${proposals.length})`))}`,
    })
    proposalsHeader.add(proposalsTitle)
    contentArea.add(proposalsHeader)

    // List proposals
    proposals.forEach((proposal, index) => {
      const isSelected = index === selectedProposalIndex && isActive
      const proposalBox = new BoxRenderable(ctx, {
        width: '100%',
        flexDirection: 'column',
        gap: 0,
        paddingLeft: 1,
        paddingRight: 1,
        paddingTop: 0,
        paddingBottom: 0,
        backgroundColor: isSelected ? colors.selectedBg : 'transparent',
        marginBottom: 1,
      })

      // Proposal title with selection indicator and checkbox
      const titleRow = new BoxRenderable(ctx, {
        width: '100%',
        flexDirection: 'row',
        gap: 1,
      })

      // Selection indicator
      const indicator = new TextRenderable(ctx, {
        content: t`${fg(isSelected ? colors.yellow : colors.textMuted)(isSelected ? '>' : ' ')}`,
      })
      titleRow.add(indicator)

      // Checkbox
      const checkbox = new TextRenderable(ctx, {
        content: t`${fg(proposal.selected ? colors.green : colors.textMuted)(proposal.selected ? '[x]' : '[ ]')}`,
      })
      titleRow.add(checkbox)

      // Priority badge
      const priorityColor = proposal.priority === 'P1' ? colors.red : proposal.priority === 'P2' ? colors.yellow : colors.textMuted
      const priority = new TextRenderable(ctx, {
        content: t`${fg(priorityColor)(proposal.priority)}`,
      })
      titleRow.add(priority)

      // Title
      const title = new TextRenderable(ctx, {
        content: t`${fg(isSelected ? colors.text : colors.textMuted)(truncate(proposal.title, 35))}`,
      })
      titleRow.add(title)

      proposalBox.add(titleRow)

      // Show details for selected proposal
      if (isSelected) {
        // Epic
        if (proposal.epic) {
          const epicRow = new TextRenderable(ctx, {
            content: t`  ${dim(fg(colors.textDim)('Epic:'))} ${fg(colors.text)(proposal.epic)}`,
          })
          proposalBox.add(epicRow)
        }

        // Description
        if (proposal.description) {
          const descRow = new TextRenderable(ctx, {
            content: t`  ${dim(fg(colors.textDim)('Scope:'))} ${fg(colors.text)(truncate(proposal.description, 40))}`,
          })
          proposalBox.add(descRow)
        }

        // Acceptance criteria count
        if (proposal.acceptanceCriteria.length > 0) {
          const acRow = new TextRenderable(ctx, {
            content: t`  ${dim(fg(colors.textDim)('AC:'))} ${fg(colors.text)(`${proposal.acceptanceCriteria.length} criteria`)}`,
          })
          proposalBox.add(acRow)
        }

        // Validation steps count
        if (proposal.validationSteps.length > 0) {
          const vsRow = new TextRenderable(ctx, {
            content: t`  ${dim(fg(colors.textDim)('Validation:'))} ${fg(colors.text)(`${proposal.validationSteps.length} steps`)}`,
          })
          proposalBox.add(vsRow)
        }

        // Review status
        const reviewStatus = new TextRenderable(ctx, {
          content: t`  ${dim(fg(colors.textDim)('Reviewed:'))} ${fg(proposal.reviewed ? colors.green : colors.yellow)(proposal.reviewed ? 'Yes' : 'No')}`,
        })
        proposalBox.add(reviewStatus)
      }

      contentArea.add(proposalBox)
    })

    // Summary of selected proposals
    const selectedCount = proposals.filter(p => p.selected).length
    if (selectedCount > 0) {
      const summaryRow = new TextRenderable(ctx, {
        content: t`${fg(colors.green)(`${selectedCount} ticket(s) selected for creation`)}`,
      })
      contentArea.add(summaryRow)
    }
  } else if (messages.length === 0) {
    // Empty state
    const emptyBox = new BoxRenderable(ctx, {
      width: '100%',
      flexDirection: 'column',
      gap: 1,
      marginTop: 2,
    })

    const emptyTitle = new TextRenderable(ctx, {
      content: t`${fg(colors.textMuted)('Describe a task to create tickets')}`,
    })
    emptyBox.add(emptyTitle)

    const emptyHint1 = new TextRenderable(ctx, {
      content: t`${dim(fg(colors.textDim)('Example: "Create a ticket to add user auth"'))}`,
    })
    emptyBox.add(emptyHint1)

    const emptyHint2 = new TextRenderable(ctx, {
      content: t`${dim(fg(colors.textDim)('The AI will help you create well-structured tickets.'))}`,
    })
    emptyBox.add(emptyHint2)

    contentArea.add(emptyBox)
  }

  container.add(contentArea)

  // T036: Add input field for sending messages to the Refine agent
  if (onSendMessage && isActive) {
    const inputWrapper = new BoxRenderable(ctx, {
      width: '100%',
      flexDirection: 'column',
      border: true,
      borderStyle: 'single',
      borderColor: colors.border,
      padding: 0,
      marginTop: 1,
    })

    const inputField = new InputRenderable(ctx, {
      width: '100%',
      height: 1,
      placeholder: 'Describe a task to create tickets...',
      placeholderColor: colors.textMuted,
      cursorColor: colors.cyan,
      textColor: colors.text,
      backgroundColor: colors.activeBg,
    })

    // Handle message submission
    inputField.on(InputRenderableEvents.ENTER, (event: unknown) => {
      const content = inputField.value?.trim()
      if (content) {
        onSendMessage(content)
        inputField.value = ''
      }
    })

    inputWrapper.add(inputField)
    container.add(inputWrapper)
  }

  return container
}

/**
 * Props for audit panel
 */
interface AuditPanelProps {
  findings: AuditFindingUI[]
  selectedIndex: number
  inProgress: boolean
  phase?: string
  progress: number
  summary?: {
    errors: number
    warnings: number
    infos: number
  }
  isActive: boolean
}

/**
 * Create the audit findings panel
 */
function createAuditPanel(ctx: RenderContext, props: AuditPanelProps): BoxRenderable {
  const { findings, selectedIndex, inProgress, phase, progress, summary, isActive } = props

  const panel = new BoxRenderable(ctx, {
    width: '100%',
    height: '100%',
    flexDirection: 'column',
    border: true,
    borderStyle: 'single',
    borderColor: isActive ? colors.cyan : colors.border,
    backgroundColor: colors.bgDark,
    padding: 1,
    gap: 1,
  })

  // Header with title and summary
  const headerRow = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
  })

  const title = new TextRenderable(ctx, {
    content: t`${bold(fg(colors.cyan)('Plan Audit'))}`,
  })
  headerRow.add(title)

  if (summary) {
    const summaryText = new TextRenderable(ctx, {
      content: t`${fg(colors.red)(`${summary.errors} errors`)} ${fg(colors.yellow)(`${summary.warnings} warnings`)} ${fg(colors.textMuted)(`${summary.infos} info`)}`,
    })
    headerRow.add(summaryText)
  }

  panel.add(headerRow)

  // Progress bar if in progress
  if (inProgress) {
    const progressRow = new BoxRenderable(ctx, {
      width: '100%',
      flexDirection: 'column',
      gap: 0,
    })

    const phaseText = new TextRenderable(ctx, {
      content: t`${fg(colors.textMuted)(`Phase: ${phase || 'starting'}...`)}`,
    })
    progressRow.add(phaseText)

    // Simple progress bar
    const barWidth = 40
    const filled = Math.round((progress / 100) * barWidth)
    const empty = barWidth - filled
    const progressBar = new TextRenderable(ctx, {
      content: t`[${'='.repeat(filled)}${' '.repeat(empty)}] ${progress}%`,
    })
    progressRow.add(progressBar)

    panel.add(progressRow)
  }

  // Findings list
  const findingsScroll = new ScrollBoxRenderable(ctx, {
    width: '100%',
    flexGrow: 1,
    flexDirection: 'column',
    gap: 1,
    backgroundColor: colors.bgDark,
    padding: 0,
  })

  if (findings.length === 0 && !inProgress) {
    const emptyText = new TextRenderable(ctx, {
      content: t`${dim(fg(colors.textMuted)('No findings. Press A to run audit.'))}`,
    })
    findingsScroll.add(emptyText)
  }

  findings.forEach((finding, index) => {
    const isSelected = index === selectedIndex
    const findingRow = new BoxRenderable(ctx, {
      width: '100%',
      flexDirection: 'column',
      backgroundColor: isSelected && isActive ? colors.selectedBg : 'transparent',
      padding: 1,
      gap: 0,
    })

    // Severity icon and message
    const severityIcon = getSeverityIcon(finding.severity)
    const severityColor = getSeverityColor(finding.severity)

    const mainLine = new TextRenderable(ctx, {
      content: t`${fg(severityColor)(`[${severityIcon}]`)} ${fg(colors.text)(truncate(finding.message, 80))}`,
    })
    findingRow.add(mainLine)

    // Second line with details
    const detailParts = []
    if (finding.ticketId) {
      detailParts.push(`Ticket: ${finding.ticketId}`)
    }
    detailParts.push(`Category: ${finding.category}`)
    detailParts.push(`Action: ${finding.suggestedAction}`)

    const detailLine = new TextRenderable(ctx, {
      content: t`${dim(fg(colors.textMuted)(detailParts.join('  |  ')))}`,
    })
    findingRow.add(detailLine)

    findingsScroll.add(findingRow)
  })

  panel.add(findingsScroll)

  // Footer with controls
  const footer = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textMuted)('j/k: navigate  Enter: apply suggestion  A: re-run  Esc: close'))}`,
  })
  panel.add(footer)

  return panel
}

/**
 * Get severity icon
 */
function getSeverityIcon(severity: string): string {
  switch (severity) {
    case 'error': return 'x'
    case 'warning': return '!'
    case 'info': return 'i'
    default: return '?'
  }
}

/**
 * Get severity color
 */
function getSeverityColor(severity: string): string {
  switch (severity) {
    case 'error': return colors.red
    case 'warning': return colors.yellow
    case 'info': return colors.cyan
    default: return colors.textMuted
  }
}

/**
 * Truncate text to max length
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength - 3) + '...'
}

/**
 * Create mock refinement messages with AI suggestions
 */
function createRefinementMessages(ticket: Ticket): ChatMessage[] {
  const messages: ChatMessage[] = [
    {
      id: '1',
      role: 'assistant',
      content: `Analyzing ticket #${ticket.number}: ${ticket.title}...`,
      timestamp: getTimestamp(),
    },
    {
      id: '2',
      role: 'assistant',
      content: `Suggested acceptance criteria:\n${ticket.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}`,
      timestamp: getTimestamp(),
    },
    {
      id: '3',
      role: 'assistant',
      content: `Estimated effort: ${ticket.points} points\nSuggested status: ${ticket.status}`,
      timestamp: getTimestamp(),
    },
    {
      id: '4',
      role: 'assistant',
      content: `Dependencies:\nBlocked by: ${ticket.blockedBy.length > 0 ? ticket.blockedBy.join(', ') : 'None'}\nBlocks: ${ticket.blocks.length > 0 ? ticket.blocks.join(', ') : 'None'}`,
      timestamp: getTimestamp(),
    },
  ]

  return messages
}

/**
 * Get current timestamp in HH:MM:SS format
 */
function getTimestamp(): string {
  const now = new Date()
  const hours = now.getHours().toString().padStart(2, '0')
  const minutes = now.getMinutes().toString().padStart(2, '0')
  const seconds = now.getSeconds().toString().padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}
