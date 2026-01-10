import { BoxRenderable, TextRenderable, ScrollBoxRenderable, t, fg, bg, bold, dim, type RenderContext } from '@opentui/core'
import { colors, bgColors } from '../utils/colors.js'
import type { Ticket, TicketStatus, Epic, Agent } from '../state/types.js'
import { createTicketCard } from './TicketCard.js'

export interface WorktreeInfo {
  epicId: string
  agentId: string
  ticketId: string
  isActive: boolean
}

export interface KanbanColumnProps {
  title: string
  status: TicketStatus
  tickets: Ticket[]
  epics: Epic[]
  agents: Agent[]
  isSelected: boolean
  selectedTicketIndex: number
  // T034: Epic grouping
  groupByEpic?: boolean
  collapsedEpics?: Set<string>
  activeWorktrees?: WorktreeInfo[]
}

const STATUS_COLORS: Record<TicketStatus, string> = {
  backlog: colors.text,
  in_progress: colors.inProgress,
  review: colors.review,
  qa: colors.yellow,
  done: colors.done,
}

/**
 * Create an epic header for grouped display
 */
function createEpicHeader(
  ctx: RenderContext,
  epic: Epic | undefined,
  ticketCount: number,
  isCollapsed: boolean,
  worktreeInfo?: WorktreeInfo
): BoxRenderable {
  const header = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 1,
    paddingBottom: 0,
    paddingLeft: 0,
    paddingRight: 0,
  })

  // Left side: collapse indicator + epic name
  const leftContent = new BoxRenderable(ctx, {
    flexDirection: 'row',
    gap: 1,
  })

  // Collapse/expand indicator
  const collapseIcon = isCollapsed ? '>' : 'v'
  const collapseText = new TextRenderable(ctx, {
    content: t`${fg(colors.textMuted)(collapseIcon)}`,
  })
  leftContent.add(collapseText)

  // Epic name or "No Epic"
  const epicName = epic?.name || 'No Epic'
  const epicText = new TextRenderable(ctx, {
    content: t`${bold(fg(colors.cyan)(epicName))}`,
  })
  leftContent.add(epicText)

  header.add(leftContent)

  // Right side: worktree indicator + count
  const rightContent = new BoxRenderable(ctx, {
    flexDirection: 'row',
    gap: 1,
  })

  // Worktree indicator (shows active agent)
  if (worktreeInfo) {
    const worktreeText = new TextRenderable(ctx, {
      content: t`${fg(colors.inProgress)('W')} ${dim(fg(colors.textMuted)(`@${worktreeInfo.agentId}`))}`,
    })
    rightContent.add(worktreeText)
  }

  // Ticket count
  const countText = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textMuted)(`(${ticketCount})`))}`,
  })
  rightContent.add(countText)

  header.add(rightContent)

  return header
}

/**
 * Group tickets by epicId
 */
function groupTicketsByEpic(tickets: Ticket[]): Map<string, Ticket[]> {
  const grouped = new Map<string, Ticket[]>()

  for (const ticket of tickets) {
    const epicId = ticket.epicId || ''
    const epicTickets = grouped.get(epicId) || []
    epicTickets.push(ticket)
    grouped.set(epicId, epicTickets)
  }

  return grouped
}

export function createKanbanColumn(ctx: RenderContext, props: KanbanColumnProps): BoxRenderable {
  const {
    title,
    status,
    tickets,
    epics,
    agents,
    isSelected,
    selectedTicketIndex,
    groupByEpic = true,
    collapsedEpics = new Set<string>(),
    activeWorktrees = [],
  } = props

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

  if (groupByEpic && tickets.length > 0) {
    // Group tickets by epic
    const groupedTickets = groupTicketsByEpic(tickets)

    // Sort epic IDs: actual epics first (alphabetically), then no-epic ('')
    const sortedEpicIds = Array.from(groupedTickets.keys()).sort((a, b) => {
      if (a === '') return 1  // No epic goes last
      if (b === '') return -1
      return a.localeCompare(b)
    })

    // Track overall ticket index for selection
    let overallTicketIndex = 0

    for (const epicId of sortedEpicIds) {
      const epicTickets = groupedTickets.get(epicId) || []
      const epic = epics.find(e => e.id === epicId)
      const isCollapsed = collapsedEpics.has(epicId)

      // Find active worktree for this epic
      const worktreeInfo = activeWorktrees.find(w => w.epicId === epicId)

      // Add epic header
      const epicHeader = createEpicHeader(ctx, epic, epicTickets.length, isCollapsed, worktreeInfo)
      ticketList.add(epicHeader)

      // Add tickets if not collapsed
      if (!isCollapsed) {
        for (const ticket of epicTickets) {
          const agent = ticket.assignee ? agents.find(a => a.id === ticket.assignee) : undefined

          const card = createTicketCard(ctx, {
            ticket,
            epic,
            agent,
            isSelected: isSelected && overallTicketIndex === selectedTicketIndex,
          })

          ticketList.add(card)
          overallTicketIndex++
        }
      } else {
        // Even when collapsed, we need to count tickets for selection purposes
        overallTicketIndex += epicTickets.length
      }
    }
  } else {
    // Original behavior: flat list without epic grouping
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
  }

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
