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
import type { ChatMessage, Ticket } from '../state/types.js'

export interface RefineViewProps {
  store: Store
  selectedTicketIndex: number
  activePane: 'sidebar' | 'chat'
}

export function createRefineView(ctx: RenderContext, props: RefineViewProps): BoxRenderable {
  const { store, selectedTicketIndex, activePane } = props
  const state = store.getState()
  const tickets = state.tickets

  // Main container - horizontal layout
  // ┌─ Tickets (20%) ──┬─ Refinement Chat (80%) ──────────────────────┐
  // │ ● #42 OAuth flow │ [ChatPanel with refinement conversation]     │
  // │   #43 Token ref  │                                               │
  // │   #44 Webhook    │ AI: I suggest these acceptance criteria:     │
  // │   #45 Rate limit │ - User can initiate OAuth flow               │
  // │                   │ - Tokens are securely stored                 │
  // │                   │                                               │
  // │                   │ [y] accept  [n] reject                       │
  // └───────────────────┴───────────────────────────────────────────────┘

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

  // Sidebar footer with help text
  const sidebarFooter = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textMuted)('j/k: nav  Tab: switch'))}`,
  })
  sidebar.add(sidebarFooter)

  container.add(sidebar)

  // Right panel - chat and suggestions (80%)
  const rightPanel = new BoxRenderable(ctx, {
    width: '80%',
    height: '100%',
    flexDirection: 'column',
    gap: 1,
  })

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

  container.add(rightPanel)

  return container
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
