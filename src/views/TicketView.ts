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
import type { Ticket, Epic } from '../state/types.js'

export interface TicketViewProps {
  ticket: Ticket
  epic?: Epic
  store: Store
  activeTab: 'ticket' | 'session'
  onTabChange?: (tab: 'ticket' | 'session') => void
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
