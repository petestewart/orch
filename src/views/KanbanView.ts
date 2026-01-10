import { BoxRenderable, TextRenderable, t, fg, dim, type RenderContext } from '@opentui/core'
import { colors } from '../utils/colors.js'
import { createKanbanColumn, type WorktreeInfo } from '../components/KanbanColumn.js'
import type { Store } from '../state/store.js'
import type { TicketStatus, Agent } from '../state/types.js'

export interface KanbanViewProps {
  store: Store
  selectedColumnIndex: number
  selectedTicketIndex: number
}

export const COLUMNS: { title: string; status: TicketStatus }[] = [
  { title: 'Backlog', status: 'backlog' },
  { title: 'In Progress', status: 'in_progress' },
  { title: 'Review', status: 'review' },
  { title: 'QA', status: 'qa' },
  { title: 'Done', status: 'done' },
]

/**
 * Build worktree info from agents working on tickets
 */
function buildWorktreeInfo(agents: Agent[], store: Store): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = []

  for (const agent of agents) {
    if (agent.status === 'working' && agent.currentTicketId) {
      const ticket = store.getTicketById(agent.currentTicketId)
      if (ticket && ticket.epicId) {
        worktrees.push({
          epicId: ticket.epicId,
          agentId: agent.id,
          ticketId: ticket.id,
          isActive: true,
        })
      }
    }
  }

  return worktrees
}

export function createKanbanView(ctx: RenderContext, props: KanbanViewProps): BoxRenderable {
  const { store, selectedColumnIndex, selectedTicketIndex } = props
  const state = store.getState()

  // Build worktree info from active agents
  const activeWorktrees = buildWorktreeInfo(state.agents, store)

  // Main container - vertical layout (filter bar + columns)
  const outerContainer = new BoxRenderable(ctx, {
    width: '100%',
    height: '100%',
    flexDirection: 'column',
    backgroundColor: colors.bg,
  })

  // Epic filter indicator bar
  const filterBar = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingRight: 2,
    paddingTop: 0,
    paddingBottom: 0,
  })

  const epicFilterName = store.getKanbanEpicFilterName()
  const filterText = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textMuted)('Epic:'))} ${fg(colors.cyan)(epicFilterName)} ${dim(fg(colors.textMuted)('[e] to cycle'))}`,
  })
  filterBar.add(filterText)
  outerContainer.add(filterBar)

  // Columns container - horizontal layout
  const columnsContainer = new BoxRenderable(ctx, {
    width: '100%',
    flexGrow: 1,
    flexDirection: 'row',
    padding: 1,
    paddingTop: 0,
    backgroundColor: colors.bg,
  })

  // Create each column
  COLUMNS.forEach((col, index) => {
    // Get tickets, applying epic filter if set
    let tickets = store.getTicketsByStatus(col.status)
    if (state.kanbanEpicFilter) {
      tickets = tickets.filter(t => t.epicId === state.kanbanEpicFilter)
    }

    const isSelected = index === selectedColumnIndex

    const column = createKanbanColumn(ctx, {
      title: col.title,
      status: col.status,
      tickets,
      epics: state.epics,
      agents: state.agents,
      isSelected,
      selectedTicketIndex: isSelected ? selectedTicketIndex : -1,
      // T034: Epic grouping props
      groupByEpic: true,
      collapsedEpics: state.kanbanCollapsedEpics,
      activeWorktrees,
    })

    columnsContainer.add(column)
  })

  outerContainer.add(columnsContainer)

  return outerContainer
}

export function getColumnTicketCount(store: Store, columnIndex: number): number {
  if (columnIndex < 0 || columnIndex >= COLUMNS.length) return 0
  return store.getTicketsByStatus(COLUMNS[columnIndex].status).length
}

export function getColumnCount(): number {
  return COLUMNS.length
}
