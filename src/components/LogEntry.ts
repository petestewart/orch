import { BoxRenderable, TextRenderable, t, fg, bg, dim, type RenderContext } from '@opentui/core'
import { colors, bgColors } from '../utils/colors.js'
import type { LogEntry } from '../state/types.js'

export interface LogEntryProps {
  entry: LogEntry
}

export function createLogEntry(ctx: RenderContext, props: LogEntryProps): BoxRenderable {
  const { entry } = props

  // Container for single row layout
  const container = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'row',
    gap: 1,
    alignItems: 'center',
  })

  // Timestamp (HH:MM:SS format)
  const timeText = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textDim)(entry.timestamp))}`,
  })
  container.add(timeText)

  // Level badge with colors
  const levelColor = entry.level === 'INFO' ? colors.info
    : entry.level === 'WARN' ? colors.warn
    : entry.level === 'ERROR' ? colors.error
    : colors.event // EVENT

  const levelBgColor = entry.level === 'INFO' ? bgColors.green
    : entry.level === 'WARN' ? bgColors.yellow
    : entry.level === 'ERROR' ? bgColors.red
    : bgColors.cyan // EVENT

  const levelBadge = new TextRenderable(ctx, {
    content: t`${bg(levelBgColor)(fg(colors.textBold)(` ${entry.level} `))}`,
  })
  container.add(levelBadge)

  // Agent ID (optional)
  if (entry.agentId) {
    const agentIdText = new TextRenderable(ctx, {
      content: t`${dim(fg(colors.textDim)(entry.agentId))}`,
    })
    container.add(agentIdText)
  }

  // Ticket number (optional)
  if (entry.ticketNumber !== undefined) {
    const ticketText = new TextRenderable(ctx, {
      content: t`${dim(fg(colors.textDim)(`#${entry.ticketNumber}`))}`,
    })
    container.add(ticketText)
  }

  // Message text
  const messageText = new TextRenderable(ctx, {
    content: t`${fg(colors.text)(entry.message)}`,
  })
  container.add(messageText)

  return container
}
