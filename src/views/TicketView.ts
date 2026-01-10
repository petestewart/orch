import {
  BoxRenderable,
  TextRenderable,
  ScrollBoxRenderable,
  TabSelectRenderable,
  t,
  fg,
  bg,
  bold,
  dim,
  type RenderContext,
  TabSelectRenderableEvents,
} from '@opentui/core'
import { colors, bgColors } from '../utils/colors.js'
import { createProgressBar } from '../components/ProgressBar.js'
import type { Store } from '../state/store.js'
import type { Ticket, Epic, Agent } from '../state/types.js'

export interface TicketViewProps {
  ticket: Ticket
  epic?: Epic
  store: Store
  activeTab: 'ticket' | 'session'
  onTabChange?: (tab: 'ticket' | 'session') => void
}

/**
 * Get action availability states for a ticket
 */
export interface TicketActionStates {
  canStart: boolean       // Can start an agent on this ticket
  canRetry: boolean       // Can retry a failed ticket
  canViewSession: boolean // Can view agent session (has agent)
  agent?: Agent           // Agent working on this ticket (if any)
  startDisabledReason?: string
  retryDisabledReason?: string
}

export function getTicketActionStates(ticket: Ticket, store: Store): TicketActionStates {
  const state = store.getState()
  const agent = ticket.assignee ? store.getAgentById(ticket.assignee) : undefined

  // Can start: ticket is in backlog status and has no unmet dependencies (ready)
  const canStart = ticket.status === 'backlog' && ticket.ready
  let startDisabledReason: string | undefined
  if (ticket.status !== 'backlog') {
    startDisabledReason = `Status is ${ticket.status}`
  } else if (!ticket.ready) {
    startDisabledReason = 'Has unmet dependencies'
  }

  // Can retry: ticket status is backlog and it was previously failed (we can tell by blockedBy containing failed info)
  // Actually, in the current state model, "Failed" maps to "backlog" so we check if it's in backlog
  // and has been worked on before (has an assignee or was previously in_progress)
  // For simplicity: ticket is in backlog and has been assigned before (has progress > 0 or has been assigned)
  // More accurately: we allow retry on any backlog ticket that's not currently being worked
  const canRetry = ticket.status === 'backlog' && !ticket.ready
  let retryDisabledReason: string | undefined
  if (ticket.status !== 'backlog') {
    retryDisabledReason = `Status is ${ticket.status}`
  } else if (ticket.ready) {
    retryDisabledReason = 'Ticket is ready to start'
  }

  // Can view session: ticket has an agent assigned
  const canViewSession = !!agent

  return {
    canStart,
    canRetry,
    canViewSession,
    agent,
    startDisabledReason,
    retryDisabledReason,
  }
}

export function createTicketView(ctx: RenderContext, props: TicketViewProps): BoxRenderable {
  const { ticket, epic, store, activeTab, onTabChange } = props
  const state = store.getState()

  // Main container - vertical layout
  const container = new BoxRenderable(ctx, {
    width: '100%',
    height: '100%',
    flexDirection: 'column',
    backgroundColor: colors.bg,
    padding: 1,
  })

  // Breadcrumb section
  const breadcrumb = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'row',
    marginBottom: 1,
    gap: 1,
  })

  const breadcrumbText = new TextRenderable(ctx, {
    content: t`${fg(colors.textDim)(`Ticket #${ticket.number}`)} ${fg(colors.textMuted)('>')} ${fg(colors.text)(ticket.title)}`,
  })
  breadcrumb.add(breadcrumbText)
  container.add(breadcrumb)

  // Tab selector
  const tabSelector = createTicketTabs(ctx, {
    activeTab,
    onTabChange,
  })
  container.add(tabSelector)

  // Action bar - shows available keyboard shortcuts with disabled states
  const actionStates = getTicketActionStates(ticket, store)
  const actionBar = createActionBar(ctx, {
    actionStates,
    ticket,
  })
  container.add(actionBar)

  // Content area - two columns
  const contentArea = new BoxRenderable(ctx, {
    width: '100%',
    height: '100%',
    flexDirection: 'row',
    gap: 2,
  })

  // Left column (main content) - 70%
  const leftColumn = new BoxRenderable(ctx, {
    width: '70%',
    height: '100%',
    flexDirection: 'column',
    gap: 1,
  })

  // Metadata section
  const metadataBox = createMetadataSection(ctx, {
    ticket,
    epic,
  })
  leftColumn.add(metadataBox)

  // Description section
  const descriptionBox = createDescriptionSection(ctx, {
    description: ticket.description,
  })
  leftColumn.add(descriptionBox)

  // Acceptance criteria section
  const criteriaBox = createAcceptanceCriteriaSection(ctx, {
    acceptanceCriteria: ticket.acceptanceCriteria,
  })
  leftColumn.add(criteriaBox)

  // Review/QA output section (only show if ticket is in review/qa or has output)
  if (ticket.status === 'review' || ticket.status === 'qa' || ticket.reviewOutput || ticket.qaOutput || ticket.rejectionFeedback) {
    const agentOutputBox = createAgentOutputSection(ctx, { ticket })
    leftColumn.add(agentOutputBox)
  }

  contentArea.add(leftColumn)

  // Right column (sidebar) - 30%
  const rightColumn = new BoxRenderable(ctx, {
    width: '30%',
    height: '100%',
    flexDirection: 'column',
    gap: 1,
  })

  // Blocked By section
  const blockedByBox = createRelationshipSection(ctx, {
    title: 'Blocked By',
    ticketIds: ticket.blockedBy,
    store,
  })
  rightColumn.add(blockedByBox)

  // Blocks section
  const blocksBox = createRelationshipSection(ctx, {
    title: 'Blocks',
    ticketIds: ticket.blocks,
    store,
  })
  rightColumn.add(blocksBox)

  contentArea.add(rightColumn)
  container.add(contentArea)

  return container
}

interface TicketTabsProps {
  activeTab: 'ticket' | 'session'
  onTabChange?: (tab: 'ticket' | 'session') => void
}

interface ActionBarProps {
  actionStates: TicketActionStates
  ticket: Ticket
}

/**
 * Create the action bar showing available keyboard shortcuts
 */
function createActionBar(ctx: RenderContext, props: ActionBarProps): BoxRenderable {
  const { actionStates, ticket } = props

  const bar = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'row',
    backgroundColor: colors.bgDark,
    padding: 1,
    gap: 2,
    marginBottom: 1,
  })

  // Helper to create action button
  const createActionButton = (
    key: string,
    label: string,
    enabled: boolean,
    disabledReason?: string
  ): TextRenderable => {
    if (enabled) {
      return new TextRenderable(ctx, {
        content: t`${bg(colors.borderDim)(fg(colors.textBold)(` ${key} `))} ${fg(colors.text)(label)}`,
      })
    } else {
      return new TextRenderable(ctx, {
        content: t`${bg(colors.bgDark)(fg(colors.textMuted)(` ${key} `))} ${fg(colors.textMuted)(label)}`,
      })
    }
  }

  // Start action (s)
  const startButton = createActionButton(
    's',
    'start',
    actionStates.canStart,
    actionStates.startDisabledReason
  )
  bar.add(startButton)

  // Retry action (r) - only for failed tickets
  const retryButton = createActionButton(
    'r',
    'retry',
    actionStates.canRetry,
    actionStates.retryDisabledReason
  )
  bar.add(retryButton)

  // View session (Tab)
  const sessionButton = createActionButton(
    'Tab',
    'session',
    actionStates.canViewSession,
    actionStates.canViewSession ? undefined : 'No active agent'
  )
  bar.add(sessionButton)

  // Review/QA-specific actions
  const canApprove = ticket.status === 'review' || ticket.status === 'qa'
  const canReject = ticket.status === 'review' || ticket.status === 'qa'
  const canTakeover = ticket.status === 'review' || ticket.status === 'qa' || ticket.status === 'in_progress'
  const canPause = ticket.automationMode !== 'paused'

  // Approve action (a)
  const approveButton = createActionButton(
    'a',
    'approve',
    canApprove
  )
  bar.add(approveButton)

  // Reject action (r) - note: 'r' is overloaded, context-sensitive
  // In review/qa: reject. In backlog: retry
  if (canReject) {
    const rejectButton = createActionButton(
      'r',
      'reject',
      canReject
    )
    // Remove the retry button and add reject instead (they share the 'r' key)
    bar.remove(retryButton.id)
    bar.add(rejectButton)
  }

  // Take over action (t)
  const takeoverButton = createActionButton(
    't',
    'take over',
    canTakeover
  )
  bar.add(takeoverButton)

  // Pause action (p)
  const pauseButton = createActionButton(
    'p',
    ticket.automationMode === 'paused' ? 'resume' : 'pause',
    canTakeover
  )
  bar.add(pauseButton)

  return bar
}

function createTicketTabs(ctx: RenderContext, props: TicketTabsProps): TabSelectRenderable {
  const tabOptions = [
    { name: 'TICKET', value: 'ticket' },
    { name: 'SESSION', value: 'session' },
  ]

  const currentIndex = props.activeTab === 'ticket' ? 0 : 1

  const tabBar = new TabSelectRenderable(ctx, {
    height: 1,
    width: '100%',
    options: tabOptions.map((tab) => ({
      name: tab.name,
      description: '',
      value: tab.value,
    })),
    tabWidth: 12,
    backgroundColor: colors.bgDark,
    textColor: colors.textDim,
    selectedBackgroundColor: colors.tabActive,
    selectedTextColor: colors.textBold,
    focusedBackgroundColor: colors.selectedBg,
    focusedTextColor: colors.text,
    showDescription: false,
    showUnderline: false,
    wrapSelection: true,
  })

  tabBar.setSelectedIndex(currentIndex)

  tabBar.on(TabSelectRenderableEvents.SELECTION_CHANGED, () => {
    const selected = tabBar.getSelectedOption()
    if (selected && selected.value && props.onTabChange) {
      props.onTabChange(selected.value as 'ticket' | 'session')
    }
  })

  return tabBar
}

interface MetadataProps {
  ticket: Ticket
  epic?: Epic
}

function createMetadataSection(ctx: RenderContext, props: MetadataProps): BoxRenderable {
  const { ticket, epic } = props

  const box = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'column',
    border: true,
    borderStyle: 'single',
    borderColor: colors.border,
    backgroundColor: colors.activeBg,
    padding: 1,
    gap: 1,
  })

  // Title row
  const titleBox = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'column',
    marginBottom: 1,
  })

  const titleText = new TextRenderable(ctx, {
    content: t`${bold(fg(colors.textBold)(ticket.title))}`,
  })
  titleBox.add(titleText)

  box.add(titleBox)

  // Metadata rows - organized in a grid-like structure
  const metadataRows = [
    ['Epic', epic ? epic.name : 'None'],
    ['Type', ticket.type],
    ['Status', ticket.status],
    ['Priority', ticket.priority],
    ['Points', `${ticket.points}`],
    ['Assignee', ticket.assignee || 'Unassigned'],
  ]

  metadataRows.forEach(([label, value]) => {
    const row = new BoxRenderable(ctx, {
      width: '100%',
      flexDirection: 'row',
      gap: 2,
    })

    const labelText = new TextRenderable(ctx, {
      content: t`${dim(fg(colors.textDim)(`${label}:`))}`,
    })
    row.add(labelText)

    // Color code different values
    let valueContent
    if (label === 'Priority') {
      const priorityColor =
        value === 'P1' ? colors.p1 : value === 'P2' ? colors.p2 : colors.p3
      valueContent = t`${fg(priorityColor)(value)}`
    } else if (label === 'Type') {
      const typeColor =
        value === 'feature'
          ? colors.feature
          : value === 'bug'
            ? colors.bug
            : colors.task
      valueContent = t`${fg(typeColor)(value)}`
    } else if (label === 'Status') {
      const statusColor =
        value === 'done'
          ? colors.done
          : value === 'review'
            ? colors.review
            : value === 'in_progress'
              ? colors.inProgress
              : colors.text
      valueContent = t`${fg(statusColor)(value)}`
    } else {
      valueContent = t`${fg(colors.text)(value)}`
    }

    const valueText = new TextRenderable(ctx, {
      content: valueContent,
    })
    row.add(valueText)

    box.add(row)
  })

  // Add progress bar if in progress
  if (ticket.status === 'in_progress' && ticket.progress !== undefined) {
    const progressLabel = new TextRenderable(ctx, {
      content: t`${dim(fg(colors.textDim)('Progress:'))}`,
    })
    box.add(progressLabel)

    const progressBar = createProgressBar(ctx, {
      progress: ticket.progress,
      width: 20,
      color: colors.inProgress,
    })
    box.add(progressBar)
  }

  return box
}

interface DescriptionProps {
  description?: string
}

function createDescriptionSection(ctx: RenderContext, props: DescriptionProps): BoxRenderable {
  const { description } = props

  const box = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'column',
    border: true,
    borderStyle: 'single',
    borderColor: colors.border,
    backgroundColor: colors.activeBg,
    padding: 1,
    gap: 1,
  })

  const titleText = new TextRenderable(ctx, {
    content: t`${bold(fg(colors.textBold)('Description'))}`,
  })
  box.add(titleText)

  if (description) {
    const descText = new TextRenderable(ctx, {
      content: t`${fg(colors.text)(description)}`,
    })
    box.add(descText)
  } else {
    const noDescText = new TextRenderable(ctx, {
      content: t`${dim(fg(colors.textMuted)('No description provided'))}`,
    })
    box.add(noDescText)
  }

  return box
}

interface AcceptanceCriteriaProps {
  acceptanceCriteria: string[]
}

function createAcceptanceCriteriaSection(
  ctx: RenderContext,
  props: AcceptanceCriteriaProps,
): BoxRenderable {
  const { acceptanceCriteria } = props

  const box = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'column',
    border: true,
    borderStyle: 'single',
    borderColor: colors.border,
    backgroundColor: colors.activeBg,
    padding: 1,
    gap: 1,
  })

  const titleText = new TextRenderable(ctx, {
    content: t`${bold(fg(colors.textBold)('Acceptance Criteria'))}`,
  })
  box.add(titleText)

  if (acceptanceCriteria.length > 0) {
    acceptanceCriteria.forEach((criterion) => {
      const itemRow = new BoxRenderable(ctx, {
        width: '100%',
        flexDirection: 'row',
        gap: 1,
      })

      // Checkbox representation
      const checkbox = new TextRenderable(ctx, {
        content: t`${fg(colors.textMuted)('☐')}`,
      })
      itemRow.add(checkbox)

      const text = new TextRenderable(ctx, {
        content: t`${fg(colors.text)(criterion)}`,
      })
      itemRow.add(text)

      box.add(itemRow)
    })
  } else {
    const noItemsText = new TextRenderable(ctx, {
      content: t`${dim(fg(colors.textMuted)('No acceptance criteria defined'))}`,
    })
    box.add(noItemsText)
  }

  return box
}

interface RelationshipProps {
  title: string
  ticketIds: string[]
  store: Store
}

function createRelationshipSection(
  ctx: RenderContext,
  props: RelationshipProps,
): BoxRenderable {
  const { title, ticketIds, store } = props

  const box = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'column',
    border: true,
    borderStyle: 'single',
    borderColor: colors.border,
    backgroundColor: colors.activeBg,
    padding: 1,
    gap: 1,
  })

  const titleText = new TextRenderable(ctx, {
    content: t`${bold(fg(colors.textBold)(title))}`,
  })
  box.add(titleText)

  if (ticketIds.length > 0) {
    ticketIds.forEach((ticketId) => {
      const relatedTicket = store.getTicketById(ticketId)
      if (relatedTicket) {
        const row = new BoxRenderable(ctx, {
          width: '100%',
          flexDirection: 'row',
          gap: 1,
          marginBottom: 1,
        })

        const ticketNumText = new TextRenderable(ctx, {
          content: t`${fg(colors.cyan)(`#${relatedTicket.number}`)}`,
        })
        row.add(ticketNumText)

        const titlePart = new TextRenderable(ctx, {
          content: t`${dim(fg(colors.textDim)(relatedTicket.title))}`,
        })
        row.add(titlePart)

        box.add(row)
      }
    })
  } else {
    const emptyText = new TextRenderable(ctx, {
      content: t`${dim(fg(colors.textMuted)('None'))}`,
    })
    box.add(emptyText)
  }

  return box
}

interface AgentOutputProps {
  ticket: Ticket
}

/**
 * Create a section to display Review/QA agent output and rejection feedback
 * This section shows the output from automated Review/QA agents and any rejection feedback
 */
function createAgentOutputSection(ctx: RenderContext, props: AgentOutputProps): BoxRenderable {
  const { ticket } = props

  const box = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'column',
    border: true,
    borderStyle: 'single',
    borderColor: ticket.awaitingApproval ? colors.yellow : colors.border,
    backgroundColor: colors.activeBg,
    padding: 1,
    gap: 1,
  })

  // Title based on status
  let titleText: string
  let titleColor: string
  if (ticket.status === 'review') {
    titleText = 'Review Agent Output'
    titleColor = colors.review
  } else if (ticket.status === 'qa') {
    titleText = 'QA Agent Output'
    titleColor = colors.yellow
  } else if (ticket.rejectionFeedback) {
    titleText = 'Rejection Feedback'
    titleColor = colors.red
  } else {
    titleText = 'Agent Output'
    titleColor = colors.text
  }

  const title = new TextRenderable(ctx, {
    content: t`${bold(fg(titleColor)(titleText))}`,
  })
  box.add(title)

  // Awaiting approval indicator
  if (ticket.awaitingApproval) {
    const approvalRow = new BoxRenderable(ctx, {
      width: '100%',
      flexDirection: 'row',
      gap: 1,
      marginBottom: 1,
    })

    const approvalIcon = new TextRenderable(ctx, {
      content: t`${fg(colors.yellowBright)('⏳')}`,
    })
    approvalRow.add(approvalIcon)

    const approvalText = new TextRenderable(ctx, {
      content: t`${bold(fg(colors.yellow)('Awaiting human approval'))} - Press ${bg(colors.borderDim)(fg(colors.textBold)(' a '))} to approve or ${bg(colors.borderDim)(fg(colors.textBold)(' r '))} to reject`,
    })
    approvalRow.add(approvalText)

    box.add(approvalRow)
  }

  // Review output
  if (ticket.reviewOutput) {
    const reviewLabel = new TextRenderable(ctx, {
      content: t`${dim(fg(colors.textDim)('Review:'))}`,
    })
    box.add(reviewLabel)

    const reviewOutput = new TextRenderable(ctx, {
      content: t`${fg(colors.text)(ticket.reviewOutput)}`,
    })
    box.add(reviewOutput)
  }

  // QA output
  if (ticket.qaOutput) {
    const qaLabel = new TextRenderable(ctx, {
      content: t`${dim(fg(colors.textDim)('QA:'))}`,
    })
    box.add(qaLabel)

    const qaOutput = new TextRenderable(ctx, {
      content: t`${fg(colors.text)(ticket.qaOutput)}`,
    })
    box.add(qaOutput)
  }

  // Rejection feedback
  if (ticket.rejectionFeedback) {
    const feedbackLabel = new TextRenderable(ctx, {
      content: t`${dim(fg(colors.textDim)('Feedback:'))}`,
    })
    box.add(feedbackLabel)

    const feedbackText = new TextRenderable(ctx, {
      content: t`${fg(colors.red)(ticket.rejectionFeedback)}`,
    })
    box.add(feedbackText)
  }

  // If no output yet, show placeholder
  if (!ticket.reviewOutput && !ticket.qaOutput && !ticket.rejectionFeedback && !ticket.awaitingApproval) {
    const placeholder = new TextRenderable(ctx, {
      content: t`${dim(fg(colors.textMuted)('Agent output will appear here when available'))}`,
    })
    box.add(placeholder)
  }

  return box
}
