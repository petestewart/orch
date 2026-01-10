import { BoxRenderable, TextRenderable, ScrollBoxRenderable, t, fg, bold, dim, type RenderContext } from '@opentui/core'
import { colors } from '../utils/colors.js'
import type { Ticket, TicketStatus, Epic, Agent } from '../state/types.js'
import { createTicketCard } from './TicketCard.js'

export interface KanbanColumnProps {
  title: string
  status: TicketStatus
  tickets: Ticket[]
  epics: Epic[]
  agents: Agent[]
  isSelected: boolean
  selectedTicketIndex: number
}

const STATUS_COLORS: Record<TicketStatus, string> = {
  backlog: colors.text,
  in_progress: colors.inProgress,
  review: colors.review,
  qa: colors.yellow,
  done: colors.done,
}

export function createKanbanColumn(ctx: RenderContext, props: KanbanColumnProps): BoxRenderable {
  const { title, status, tickets, epics, agents, isSelected, selectedTicketIndex } = props

  // Column container
  const column = new BoxRenderable(ctx, {
    flexGrow: 1,
    flexBasis: 0,
    height: '100%',
    flexDirection: 'column',
    border: true,
    borderStyle: 'single',
    borderColor: isSelected ? colors.selected : colors.border,
    backgroundColor: colors.bg,
    marginRight: 1,
  })

  // Header with title and count
  const header = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 1,
    paddingBottom: 0,
  })

  const statusColor = STATUS_COLORS[status]
  const titleText = new TextRenderable(ctx, {
    content: t`${bold(fg(statusColor)(title))}`,
  })

  const countText = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textMuted)(`(${tickets.length})`))}`,
  })

  header.add(titleText)
  header.add(countText)
  column.add(header)

  // Scrollable ticket list
  const ticketList = new ScrollBoxRenderable(ctx, {
    flexGrow: 1,
    width: '100%',
    padding: 1,
    flexDirection: 'column',
  })

  // Add ticket cards
  tickets.forEach((ticket, index) => {
    const epic = epics.find(e => e.id === ticket.epicId)
    const agent = ticket.assignee ? agents.find(a => a.id === ticket.assignee) : undefined

    const card = createTicketCard(ctx, {
      ticket,
      epic,
      agent,
      isSelected: isSelected && index === selectedTicketIndex,
    })

    ticketList.add(card)
  })

  // Empty state
  if (tickets.length === 0) {
    const emptyText = new TextRenderable(ctx, {
      content: t`${dim(fg(colors.textMuted)('No tickets'))}`,
    })
    ticketList.add(emptyText)
  }

  column.add(ticketList)

  return column
}
