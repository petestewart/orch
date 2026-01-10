import {
  BoxRenderable,
  TextRenderable,
  ScrollBoxRenderable,
  InputRenderable,
  t,
  fg,
  bg,
  bold,
  dim,
  type RenderContext,
} from '@opentui/core'
import { colors, bgColors } from '../utils/colors.js'
import { createLogEntry } from '../components/LogEntry.js'
import type { Store } from '../state/store.js'
import type { LogLevel } from '../state/types.js'

export interface LogsViewProps {
  store: Store
  selectedLogIndex: number
}

export function createLogsView(ctx: RenderContext, props: LogsViewProps): BoxRenderable {
  const { store } = props
  const state = store.getState()

  // Get filter state from store
  const levelFilter = state.logsLevelFilter
  const agentFilter = state.logsAgentFilter
  const ticketFilter = state.logsTicketFilter
  const searchQuery = state.logsSearchQuery
  const autoScroll = state.logsAutoScroll

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
    autoScroll,
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
  // When auto-scroll is enabled, show newest at bottom (normal order)
  // When disabled, show newest at top (reversed order for easier reading)
  const logsToShow = autoScroll ? [...filteredLogs].reverse() : filteredLogs
  logsToShow.forEach((log) => {
    const logEntry = createLogEntry(ctx, { entry: log })
    logsScrollBox.add(logEntry)
  })

  container.add(logsScrollBox)

  // Status bar with pagination info and keyboard hints
  const statusBar = createStatusBar(ctx, {
    totalLogs: state.logs.length,
    filteredLogs: filteredLogs.length,
    autoScroll,
  })
  container.add(statusBar)

  return container
}

interface FilterBarProps {
  levelFilter?: LogLevel
  agentFilter?: string
  ticketFilter?: number
  searchQuery?: string
  autoScroll: boolean
}

function createFilterBar(ctx: RenderContext, props: FilterBarProps): BoxRenderable {
  const { levelFilter, agentFilter, ticketFilter, searchQuery, autoScroll } = props

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

  // Level filter (press 'l' to cycle)
  const levelLabel = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textDim)('[l] Level:'))}`,
  })
  filterBar.add(levelLabel)

  const levelColor = levelFilter === 'INFO' ? colors.info
    : levelFilter === 'WARN' ? colors.warn
    : levelFilter === 'ERROR' ? colors.error
    : levelFilter === 'EVENT' ? colors.event
    : colors.text

  const levelValue = new TextRenderable(ctx, {
    content: t`${fg(levelColor)(levelFilter || 'ALL')}`,
  })
  filterBar.add(levelValue)

  // Agent filter (press 'a' to cycle)
  const agentLabel = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textDim)('[a] Agent:'))}`,
  })
  filterBar.add(agentLabel)

  const agentValue = new TextRenderable(ctx, {
    content: t`${fg(colors.text)(agentFilter || 'ALL')}`,
  })
  filterBar.add(agentValue)

  // Ticket filter (press 't' to cycle)
  const ticketLabel = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textDim)('[t] Ticket:'))}`,
  })
  filterBar.add(ticketLabel)

  const ticketValue = new TextRenderable(ctx, {
    content: t`${fg(colors.text)(ticketFilter !== undefined ? `T${String(ticketFilter).padStart(3, '0')}` : 'ALL')}`,
  })
  filterBar.add(ticketValue)

  // Auto-scroll toggle (press 's' to toggle)
  const autoScrollLabel = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textDim)('[s] Auto-scroll:'))}`,
  })
  filterBar.add(autoScrollLabel)

  const autoScrollValue = new TextRenderable(ctx, {
    content: autoScroll
      ? t`${bg(bgColors.green)(fg(colors.textBold)(' ON '))}`
      : t`${dim(fg(colors.textDim)('OFF'))}`,
  })
  filterBar.add(autoScrollValue)

  // Clear filters hint (press 'c')
  const clearHint = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textDim)('[c] Clear'))}`,
  })
  filterBar.add(clearHint)

  return filterBar
}

interface StatusBarProps {
  totalLogs: number
  filteredLogs: number
  autoScroll: boolean
}

function createStatusBar(ctx: RenderContext, props: StatusBarProps): BoxRenderable {
  const { totalLogs, filteredLogs, autoScroll } = props

  const statusBar = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 2,
  })

  // Left side: entry count
  const leftBox = new BoxRenderable(ctx, {
    flexDirection: 'row',
    gap: 1,
  })

  const infoText = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textMuted)(`Showing ${filteredLogs} of ${totalLogs} entries`))}`,
  })
  leftBox.add(infoText)

  // Show filter active indicator if any filter is set
  if (filteredLogs < totalLogs) {
    const filterActive = new TextRenderable(ctx, {
      content: t`${fg(colors.warn)(' (filtered)')}`,
    })
    leftBox.add(filterActive)
  }

  statusBar.add(leftBox)

  // Right side: keyboard hints
  const rightBox = new BoxRenderable(ctx, {
    flexDirection: 'row',
    gap: 2,
  })

  const navHint = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textDim)('j/k: scroll'))}`,
  })
  rightBox.add(navHint)

  if (autoScroll) {
    const autoScrollHint = new TextRenderable(ctx, {
      content: t`${dim(fg(colors.textDim)('(auto-scrolling to newest)'))}`,
    })
    rightBox.add(autoScrollHint)
  }

  statusBar.add(rightBox)

  return statusBar
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

// Export helper for navigation - returns filtered log count
export function getLogCount(store: Store): number {
  const state = store.getState()
  return filterLogs(state.logs, {
    levelFilter: state.logsLevelFilter,
    agentFilter: state.logsAgentFilter,
    ticketFilter: state.logsTicketFilter,
    searchQuery: state.logsSearchQuery,
  }).length
}
