import { BoxRenderable, TextRenderable, ScrollBoxRenderable, t, fg, bold, dim, type RenderContext } from '@opentui/core'
import { colors } from '../utils/colors.js'
import { createAgentCard } from '../components/AgentCard.js'
import type { Store } from '../state/store.js'
import type { Agent } from '../state/types.js'

export interface AgentsViewProps {
  store: Store
  selectedAgentIndex: number
}

export function createAgentsView(ctx: RenderContext, props: AgentsViewProps): BoxRenderable {
  const { store, selectedAgentIndex } = props
  const state = store.getState()
  const agents = state.agents

  // Main container
  const container = new BoxRenderable(ctx, {
    width: '100%',
    height: '100%',
    flexDirection: 'column',
    backgroundColor: colors.bg,
    padding: 1,
    gap: 1,
  })

  // Summary bar section
  const summaryBar = createSummaryBar(ctx, agents, store)
  container.add(summaryBar)

  // Scrollable list of agent cards
  const agentList = new ScrollBoxRenderable(ctx, {
    flexGrow: 1,
    width: '100%',
    flexDirection: 'column',
    gap: 0,
  })

  // Add agent cards
  agents.forEach((agent, index) => {
    const ticket = agent.currentTicketId ? store.getTicketById(agent.currentTicketId) : undefined
    const isSelected = index === selectedAgentIndex

    const card = createAgentCard(ctx, {
      agent,
      ticket,
      isSelected,
    })

    agentList.add(card)
  })

  // Empty state
  if (agents.length === 0) {
    const emptyText = new TextRenderable(ctx, {
      content: t`${dim(fg(colors.textMuted)('No agents'))}`,
    })
    agentList.add(emptyText)
  }

  container.add(agentList)

  return container
}

function createSummaryBar(ctx: RenderContext, agents: Agent[], store: Store): BoxRenderable {
  // Calculate summary stats
  const activeCount = agents.filter((a: Agent) => a.status === 'working').length
  const idleCount = agents.filter((a: Agent) => a.status === 'idle').length
  const waitingCount = agents.filter((a: Agent) => a.status === 'waiting').length
  const totalCount = agents.length
  const totalCost = agents.reduce((sum: number, a: Agent) => sum + a.cost, 0)

  // Summary bar container
  const summaryBox = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'row',
    border: true,
    borderStyle: 'single',
    borderColor: colors.border,
    backgroundColor: colors.activeBg,
    padding: 1,
    gap: 2,
    justifyContent: 'space-between',
  })

  // Left side: counts
  const countsBox = new BoxRenderable(ctx, {
    flexDirection: 'row',
    gap: 2,
  })

  // Active count
  const activeText = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textMuted)('Active:'))} ${fg(colors.working)(activeCount.toString())}`,
  })
  countsBox.add(activeText)

  // Waiting count
  const waitingText = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textMuted)('Waiting:'))} ${fg(colors.waiting)(waitingCount.toString())}`,
  })
  countsBox.add(waitingText)

  // Idle count
  const idleText = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textMuted)('Idle:'))} ${fg(colors.idle)(idleCount.toString())}`,
  })
  countsBox.add(idleText)

  // Total count
  const totalText = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textMuted)('Total:'))} ${fg(colors.text)(totalCount.toString())}`,
  })
  countsBox.add(totalText)

  summaryBox.add(countsBox)

  // Right side: cost
  const costText = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textMuted)('Cost:'))} ${fg(colors.text)(`$${totalCost.toFixed(2)}`)}`,
  })
  summaryBox.add(costText)

  return summaryBox
}

export function getAgentCount(store: Store): number {
  return store.getState().agents.length
}
