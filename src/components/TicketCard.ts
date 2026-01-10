import { BoxRenderable, TextRenderable, t, fg, bg, bold, dim, type RenderContext } from '@opentui/core'
import { colors, bgColors } from '../utils/colors.js'
import type { Ticket, Epic, Agent } from '../state/types.js'

export interface TicketCardProps {
  ticket: Ticket
  epic?: Epic
  agent?: Agent
  isSelected: boolean
}

export function createTicketCard(ctx: RenderContext, props: TicketCardProps): BoxRenderable {
  const { ticket, epic, agent, isSelected } = props

  // Card container
  const card = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'column',
    border: true,
    borderStyle: 'single',
    borderColor: isSelected ? colors.selected : colors.border,
    backgroundColor: isSelected ? colors.selectedBg : colors.bg,
    padding: 1,
    marginBottom: 1,
  })

  // Top row: Epic badge + Ticket number + Priority
  const topRow = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 1,
  })

  // Epic badge + ticket number
  const leftInfo = new BoxRenderable(ctx, {
    flexDirection: 'row',
    gap: 1,
  })

  if (epic) {
    const epicBadge = new TextRenderable(ctx, {
      content: t`${bg(bgColors.blue)(fg(colors.textBold)(` ${epic.name} `))}`,
    })
    leftInfo.add(epicBadge)
  }

  const ticketNum = new TextRenderable(ctx, {
    content: t`${fg(colors.textDim)(`#${ticket.number}`)}`,
  })
  leftInfo.add(ticketNum)

  // Priority badge
  const priorityColor = ticket.priority === 'P1' ? colors.p1
    : ticket.priority === 'P2' ? colors.p2
    : colors.p3
  const priority = new TextRenderable(ctx, {
    content: t`${fg(priorityColor)(ticket.priority)}`,
  })

  topRow.add(leftInfo)
  topRow.add(priority)
  card.add(topRow)

  // Title row
  const titleText = new TextRenderable(ctx, {
    content: t`${fg(colors.text)(ticket.title)}`,
  })
  card.add(titleText)

  // Bottom row: Type + Points + Assignee + Status indicators
  const bottomRow = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 1,
  })

  // Type and points
  const typeColor = ticket.type === 'feature' ? colors.feature
    : ticket.type === 'bug' ? colors.bug
    : colors.task
  const typePointsText = new TextRenderable(ctx, {
    content: t`${fg(typeColor)(ticket.type)} ${dim(fg(colors.textMuted)(`${ticket.points}pt`))}`,
  })
  bottomRow.add(typePointsText)

  // Right side: assignee + status indicators
  const rightInfo = new BoxRenderable(ctx, {
    flexDirection: 'row',
    gap: 1,
  })

  // Assignee
  if (ticket.assignee) {
    const assigneeText = new TextRenderable(ctx, {
      content: t`${fg(colors.textDim)(`@${ticket.assignee}`)}`,
    })
    rightInfo.add(assigneeText)
  }

  // Ready indicator
  if (ticket.status === 'backlog') {
    if (ticket.ready) {
      const readyBadge = new TextRenderable(ctx, {
        content: t`${fg(colors.ready)('●')} ${dim(fg(colors.textDim)('ready'))}`,
      })
      rightInfo.add(readyBadge)
    } else if (ticket.blockedBy.length > 0) {
      const blockedBadge = new TextRenderable(ctx, {
        content: t`${fg(colors.blocked)('●')} ${dim(fg(colors.textDim)('blocked'))}`,
      })
      rightInfo.add(blockedBadge)
    }
  }

  // Progress for in-progress tickets
  if (ticket.status === 'in_progress' && ticket.progress !== undefined) {
    const progressText = new TextRenderable(ctx, {
      content: t`${fg(colors.inProgress)(`${ticket.progress}%`)}`,
    })
    rightInfo.add(progressText)
  }

  // Review indicator - show when ticket is in review status
  if (ticket.status === 'review') {
    const reviewIndicator = new TextRenderable(ctx, {
      content: t`${fg(colors.review)('◉')} ${dim(fg(colors.textDim)('reviewing'))}`,
    })
    rightInfo.add(reviewIndicator)
  }

  // QA indicator - show when ticket is in QA status
  if (ticket.status === 'qa') {
    const qaIndicator = new TextRenderable(ctx, {
      content: t`${fg(colors.yellow)('◉')} ${dim(fg(colors.textDim)('testing'))}`,
    })
    rightInfo.add(qaIndicator)
  }

  // Awaiting approval indicator - show when ticket needs human approval
  if (ticket.awaitingApproval) {
    const approvalIndicator = new TextRenderable(ctx, {
      content: t`${fg(colors.yellowBright)('⏳')} ${bold(fg(colors.yellow)('approval'))}`,
    })
    rightInfo.add(approvalIndicator)
  }

  // Paused automation indicator
  if (ticket.automationMode === 'paused') {
    const pausedIndicator = new TextRenderable(ctx, {
      content: t`${fg(colors.textMuted)('⏸')} ${dim(fg(colors.textDim)('paused'))}`,
    })
    rightInfo.add(pausedIndicator)
  }

  // Manual mode indicator
  if (ticket.automationMode === 'manual') {
    const manualIndicator = new TextRenderable(ctx, {
      content: t`${fg(colors.cyan)('✋')} ${dim(fg(colors.textDim)('manual'))}`,
    })
    rightInfo.add(manualIndicator)
  }

  bottomRow.add(rightInfo)
  card.add(bottomRow)

  return card
}
