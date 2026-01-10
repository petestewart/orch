import { BoxRenderable, type RenderContext } from '@opentui/core'
import { colors } from '../utils/colors.js'
import { createKanbanColumn } from '../components/KanbanColumn.js'
import type { Store } from '../state/store.js'
import type { TicketStatus } from '../state/types.js'

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

export function createKanbanView(ctx: RenderContext, props: KanbanViewProps): BoxRenderable {
  const { store, selectedColumnIndex, selectedTicketIndex } = props
  const state = store.getState()

  // Main container - horizontal layout for columns
  const container = new BoxRenderable(ctx, {
    width: '100%',
    height: '100%',
    flexDirection: 'row',
    padding: 1,
    backgroundColor: colors.bg,
  })

  // Create each column
  COLUMNS.forEach((col, index) => {
    const tickets = store.getTicketsByStatus(col.status)
    const isSelected = index === selectedColumnIndex

    const column = createKanbanColumn(ctx, {
      title: col.title,
      status: col.status,
      tickets,
      epics: state.epics,
      agents: state.agents,
      isSelected,
      selectedTicketIndex: isSelected ? selectedTicketIndex : -1,
    })

    container.add(column)
  })

  return container
}

export function getColumnTicketCount(store: Store, columnIndex: number): number {
  if (columnIndex < 0 || columnIndex >= COLUMNS.length) return 0
  return store.getTicketsByStatus(COLUMNS[columnIndex].status).length
}

export function getColumnCount(): number {
  return COLUMNS.length
}
