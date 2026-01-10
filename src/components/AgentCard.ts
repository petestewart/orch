import { BoxRenderable, TextRenderable, t, fg, bg, bold, dim, type RenderContext } from '@opentui/core'
import { colors, bgColors } from '../utils/colors.js'
import { createProgressBar } from './ProgressBar.js'
import type { Agent, Ticket } from '../state/types.js'

export interface AgentCardProps {
  agent: Agent
  ticket?: Ticket  // Current ticket being worked on
  isSelected?: boolean
}

export function createAgentCard(ctx: RenderContext, props: AgentCardProps): BoxRenderable {
  const { agent, ticket, isSelected = false } = props

  // Main card container
  const card = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'column',
    border: true,
    borderStyle: 'single',
    borderColor: isSelected ? colors.selected : colors.border,
    backgroundColor: isSelected ? colors.selectedBg : colors.bg,
    padding: 1,
    marginBottom: 1,
    gap: 1,
  })

  // Header: Agent ID and Model
  const header = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 0,
  })

  const agentInfo = new TextRenderable(ctx, {
    content: t`${bold(fg(colors.text)(`${agent.id}`))} ${dim(fg(colors.textDim)(`(${agent.model}`))}`,
  })
  header.add(agentInfo)

  // Status badge
  const statusColor = agent.status === 'working' ? colors.working
    : agent.status === 'waiting' ? colors.waiting
    : colors.idle
  const statusText = new TextRenderable(ctx, {
    content: t`${bg(bgColors.blue)(fg(colors.textBold)(` ${agent.status} `))}`,
  })
  header.add(statusText)

  card.add(header)

  // Ticket box (if ticket is provided)
  if (ticket) {
    const ticketBox = new BoxRenderable(ctx, {
      width: '100%',
      flexDirection: 'row',
      border: true,
      borderStyle: 'single',
      borderColor: colors.borderDim,
      padding: 1,
      paddingLeft: 1,
      paddingRight: 1,
      gap: 1,
    })

    // Ticket number badge
    const ticketBadge = new TextRenderable(ctx, {
      content: t`${fg(colors.textDim)(`#${ticket.number}`)}`,
    })
    ticketBox.add(ticketBadge)

    // Ticket title
    const ticketTitle = new TextRenderable(ctx, {
      content: t`${fg(colors.text)(ticket.title)}`,
    })
    ticketBox.add(ticketTitle)

    card.add(ticketBox)
  }

  // Stats row
  const statsRow = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 2,
  })

  // Status stat
  const statusStat = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textMuted)('Status:'))} ${fg(statusColor)(agent.status)}`,
  })
  statsRow.add(statusStat)

  // Elapsed stat
  const elapsedStat = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textMuted)('Elapsed:'))} ${fg(colors.text)(agent.elapsed)}`,
  })
  statsRow.add(elapsedStat)

  // Tokens stat (In/Out)
  const tokensStat = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textMuted)('Tokens:'))} ${fg(colors.text)(`${agent.tokensIn}/${agent.tokensOut}`)}`,
  })
  statsRow.add(tokensStat)

  // Cost stat
  const costStat = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textMuted)('Cost:'))} ${fg(colors.text)(`$${agent.cost.toFixed(2)}`)}`,
  })
  statsRow.add(costStat)

  card.add(statsRow)

  // Progress bar
  const progressBar = createProgressBar(ctx, {
    progress: agent.progress,
    width: 20,
    color: statusColor,
  })
  card.add(progressBar)

  // Last action
  if (agent.lastAction) {
    const lastActionText = new TextRenderable(ctx, {
      content: t`${dim(fg(colors.textMuted)('Last:'))} ${fg(colors.text)(agent.lastAction)}`,
    })
    card.add(lastActionText)
  }

  return card
}
