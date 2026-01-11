import {
  BoxRenderable,
  TextRenderable,
  ScrollBoxRenderable,
  t,
  fg,
  bold,
  dim,
  type RenderContext,
} from '@opentui/core'
import { colors } from '../utils/colors.js'
import { createChatPanel } from '../components/ChatPanel.js'
import type { Store } from '../state/store.js'
import type { ChatMessage, Ticket, AuditFindingUI } from '../state/types.js'

export interface RefineViewProps {
  store: Store
  selectedTicketIndex: number
  activePane: 'sidebar' | 'chat' | 'audit'
}

export function createRefineView(ctx: RenderContext, props: RefineViewProps): BoxRenderable {
  const { store, selectedTicketIndex, activePane } = props
  const state = store.getState()
  const tickets = state.tickets

  // Check if we should show audit findings
  const showAudit = state.auditFindings.length > 0 || state.auditInProgress

  // Main container - horizontal layout
  // ┌─ Tickets (20%) ──┬─ Refinement Chat / Audit (80%) ─────────────────┐
  // │ ● #42 OAuth flow │ [ChatPanel with refinement conversation]         │
  // │   #43 Token ref  │  or                                              │
  // │   #44 Webhook    │ [Audit Findings List]                            │
  // │   #45 Rate limit │                                                  │
  // │                   │                                                  │
  // │                   │                                                  │
  // │                   │ [y] accept  [n] reject                          │
  // └───────────────────┴─────────────────────────────────────────────────┘

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
    borderColor: colors.border,
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
    const isActivePaneSidebar = activePane === 'sidebar'

    const ticketItem = new BoxRenderable(ctx, {
      width: '100%',
      flexDirection: 'row',
      gap: 1,
      paddingLeft: 1,
      paddingRight: 1,
      paddingTop: 0,
      paddingBottom: 0,
      backgroundColor: isSelected && isActivePaneSidebar ? colors.selectedBg : 'transparent',
      marginBottom: 0,
    })

    // Selection indicator
    const indicator = new TextRenderable(ctx, {
      content: t`${fg(isSelected && isActivePaneSidebar ? colors.yellow : colors.textMuted)(isSelected && isActivePaneSidebar ? '●' : '○')}`,
    })
    ticketItem.add(indicator)

    // Ticket number and title
    const ticketText = new TextRenderable(ctx, {
      content: t`${fg(colors.cyan)(`#${ticket.number}`)} ${fg(colors.text)(ticket.title)}`,
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

  // Sidebar footer with help text (show 'A' for audit)
  const sidebarFooter = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textMuted)('j/k: nav  Tab: switch  A: audit'))}`,
  })
  sidebar.add(sidebarFooter)

  container.add(sidebar)

  // Right panel - chat or audit findings (80%)
  const rightPanel = new BoxRenderable(ctx, {
    width: '80%',
    height: '100%',
    flexDirection: 'column',
    gap: 1,
  })

  if (showAudit) {
    // Show audit findings panel
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
  } else {
    // Get the selected ticket
    const selectedTicket = tickets[selectedTicketIndex]

    // Create refinement messages for the selected ticket
    const refinementMessages = selectedTicket ? createRefinementMessages(selectedTicket) : []

    // Create chat panel
    const chatPanel = createChatPanel(ctx, {
      messages: refinementMessages,
      onSendMessage: undefined, // Mock implementation
      placeholder: 'Refine acceptance criteria, estimates...',
    })

    rightPanel.add(chatPanel)
  }

  container.add(rightPanel)

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
