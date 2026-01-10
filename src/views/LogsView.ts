import {
  BoxRenderable,
  TextRenderable,
  ScrollBoxRenderable,
  InputRenderable,
  t,
  fg,
  bold,
  dim,
  type RenderContext,
} from '@opentui/core'
import { colors } from '../utils/colors.js'
import { createLogEntry } from '../components/LogEntry.js'
import type { Store } from '../state/store.js'
import type { LogLevel } from '../state/types.js'

export interface LogsViewProps {
  store: Store
  selectedLogIndex: number
  levelFilter?: LogLevel
  agentFilter?: string
  ticketFilter?: number
  searchQuery?: string
}

export function createLogsView(ctx: RenderContext, props: LogsViewProps): BoxRenderable {
  const { store, levelFilter, agentFilter, ticketFilter, searchQuery } = props
  const state = store.getState()

  // Main container - vertical layout
  const container = new BoxRenderable(ctx, {
    width: '100%',
    height: '100%',
    flexDirection: 'column',
    backgroundColor: colors.bg,
    padding: 1,
    gap: 1,
  })

  // Filter bar
  const filterBar = createFilterBar(ctx, {
    levelFilter,
    agentFilter,
    ticketFilter,
    searchQuery,
  })
  container.add(filterBar)

  // Logs scroll box with filtered logs
  const filteredLogs = filterLogs(state.logs, {
    levelFilter,
    agentFilter,
    ticketFilter,
    searchQuery,
  })

  const logsScrollBox = new ScrollBoxRenderable(ctx, {
    width: '100%',
    flexGrow: 1,
    flexDirection: 'column',
    gap: 0,
    backgroundColor: colors.bg,
    borderColor: colors.border,
    border: true,
    borderStyle: 'single',
    padding: 1,
  })

  // Add log entries to scroll box
  filteredLogs.forEach((log) => {
    const logEntry = createLogEntry(ctx, { entry: log })
    logsScrollBox.add(logEntry)
  })

  container.add(logsScrollBox)

  // Pagination info
  const paginationInfo = createPaginationInfo(ctx, {
    totalLogs: state.logs.length,
    filteredLogs: filteredLogs.length,
  })
  container.add(paginationInfo)

  return container
}

interface FilterBarProps {
  levelFilter?: LogLevel
  agentFilter?: string
  ticketFilter?: number
  searchQuery?: string
}

function createFilterBar(ctx: RenderContext, props: FilterBarProps): BoxRenderable {
  const { levelFilter, agentFilter, ticketFilter, searchQuery } = props

  const filterBar = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'row',
    gap: 2,
    alignItems: 'center',
    border: true,
    borderStyle: 'single',
    borderColor: colors.border,
    backgroundColor: colors.activeBg,
    padding: 1,
  })

  // Level filter
  const levelLabel = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textDim)('Level:'))}`,
  })
  filterBar.add(levelLabel)

  const levelValue = new TextRenderable(ctx, {
    content: t`${fg(colors.text)(`${levelFilter || 'ALL'} ▼`)}`,
  })
  filterBar.add(levelValue)

  // Agent filter
  const agentLabel = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textDim)('Agent:'))}`,
  })
  filterBar.add(agentLabel)

  const agentValue = new TextRenderable(ctx, {
    content: t`${fg(colors.text)(`${agentFilter || 'ALL'} ▼`)}`,
  })
  filterBar.add(agentValue)

  // Ticket filter
  const ticketLabel = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textDim)('Ticket:'))}`,
  })
  filterBar.add(ticketLabel)

  const ticketValue = new TextRenderable(ctx, {
    content: t`${fg(colors.text)(`${ticketFilter !== undefined ? `#${ticketFilter}` : 'ALL'} ▼`)}`,
  })
  filterBar.add(ticketValue)

  // Search input placeholder
  const searchLabel = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textDim)('Search:'))}`,
  })
  filterBar.add(searchLabel)

  const searchValue = new TextRenderable(ctx, {
    content: t`${fg(colors.textDim)(`[${searchQuery || '___________'}]`)}`,
  })
  filterBar.add(searchValue)

  return filterBar
}

interface PaginationInfoProps {
  totalLogs: number
  filteredLogs: number
}

function createPaginationInfo(ctx: RenderContext, props: PaginationInfoProps): BoxRenderable {
  const { totalLogs, filteredLogs } = props

  const pagination = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
  })

  const infoText = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textMuted)(`Showing ${filteredLogs} of ${totalLogs} entries`))}`,
  })
  pagination.add(infoText)

  return pagination
}

function filterLogs(
  logs: ReturnType<Store['getState']>['logs'],
  filters: {
    levelFilter?: LogLevel
    agentFilter?: string
    ticketFilter?: number
    searchQuery?: string
  },
) {
  return logs.filter((log) => {
    // Filter by level
    if (filters.levelFilter && log.level !== filters.levelFilter) {
      return false
    }

    // Filter by agent
    if (filters.agentFilter && log.agentId !== filters.agentFilter) {
      return false
    }

    // Filter by ticket
    if (filters.ticketFilter !== undefined && log.ticketNumber !== filters.ticketFilter) {
      return false
    }

    // Filter by search query (case-insensitive search in message)
    if (filters.searchQuery) {
      const query = filters.searchQuery.toLowerCase()
      const messageMatch = log.message.toLowerCase().includes(query)
      const agentMatch = log.agentId?.toLowerCase().includes(query)
      const ticketMatch = log.ticketNumber?.toString().includes(query)

      if (!messageMatch && !agentMatch && !ticketMatch) {
        return false
      }
    }

    return true
  })
}

// Export helper for navigation
export function getLogCount(store: Store): number {
  return store.getState().logs.length
}
