import {
  BoxRenderable,
  TextRenderable,
  ScrollBoxRenderable,
  CodeRenderable,
  SyntaxStyle,
  t,
  fg,
  bold,
  dim,
  type RenderContext,
} from '@opentui/core'
import { colors } from '../utils/colors.js'
import { createProgressBar } from '../components/ProgressBar.js'
import type { Agent, Ticket } from '../state/types.js'

// Create a default syntax style for code blocks
const defaultSyntaxStyle = SyntaxStyle.create()

export interface SessionViewProps {
  agent?: Agent
  ticket: Ticket
}

export interface SessionEvent {
  type: 'message' | 'tool' | 'code'
  content?: string
  tool?: string
  args?: string
  result?: string
  language?: string
  code?: string
}

export function createSessionView(ctx: RenderContext, props: SessionViewProps): BoxRenderable {
  const { agent, ticket } = props

  // Main container - vertical layout
  const container = new BoxRenderable(ctx, {
    width: '100%',
    height: '100%',
    flexDirection: 'column',
    backgroundColor: colors.bg,
    padding: 1,
    gap: 1,
  })

  // Top section: Progress bar with elapsed time
  if (agent) {
    const progressSection = createProgressSection(ctx, { agent })
    container.add(progressSection)
  }

  // Session log area - scrollable
  const sessionLog = new ScrollBoxRenderable(ctx, {
    width: '100%',
    flexGrow: 1,
    flexDirection: 'column',
    gap: 1,
  })

  // Mock session events
  const mockSessionEvents = createMockSessionEvents()

  // Add session events to log
  mockSessionEvents.forEach((event) => {
    const eventElement = createSessionEventElement(ctx, event)
    sessionLog.add(eventElement)
  })

  container.add(sessionLog)

  return container
}

interface ProgressSectionProps {
  agent: Agent
}

function createProgressSection(ctx: RenderContext, props: ProgressSectionProps): BoxRenderable {
  const { agent } = props

  const section = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'column',
    gap: 1,
    border: true,
    borderStyle: 'single',
    borderColor: colors.border,
    backgroundColor: colors.activeBg,
    padding: 1,
  })

  // Agent info and elapsed time
  const headerBox = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
  })

  const agentInfoText = new TextRenderable(ctx, {
    content: t`${bold(fg(colors.text)(agent.name))} ${dim(fg(colors.textDim)(`(${agent.model})`))}`,
  })
  headerBox.add(agentInfoText)

  const elapsedText = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textDim)(`Elapsed: ${agent.elapsed}`))}`,
  })
  headerBox.add(elapsedText)

  section.add(headerBox)

  // Progress bar
  const progressBar = createProgressBar(ctx, {
    progress: agent.progress,
    width: 30,
    color: colors.inProgress,
  })
  section.add(progressBar)

  // Status and tokens info
  const statusBox = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 2,
  })

  const statusColor =
    agent.status === 'working'
      ? colors.working
      : agent.status === 'waiting'
        ? colors.waiting
        : colors.idle

  const statusText = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textDim)('Status:'))} ${fg(statusColor)(agent.status)}`,
  })
  statusBox.add(statusText)

  const tokensText = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textDim)(`Tokens: ${agent.tokensIn}/${agent.tokensOut}`))}`,
  })
  statusBox.add(tokensText)

  const costText = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textDim)(`Cost: $${agent.cost.toFixed(4)}`))}`,
  })
  statusBox.add(costText)

  section.add(statusBox)

  return section
}

function createSessionEventElement(ctx: RenderContext, event: SessionEvent): BoxRenderable {
  const eventBox = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'column',
    gap: 1,
    border: true,
    borderStyle: 'single',
    borderColor: colors.borderDim,
    backgroundColor: colors.activeBg,
    padding: 1,
  })

  if (event.type === 'message') {
    // Message event
    const messageText = new TextRenderable(ctx, {
      content: t`${fg(colors.cyan)('→')} ${fg(colors.text)(event.content || '')}`,
    })
    eventBox.add(messageText)
  } else if (event.type === 'tool') {
    // Tool call event
    const toolHeader = new BoxRenderable(ctx, {
      width: '100%',
      flexDirection: 'row',
      gap: 1,
    })

    const toolIcon = new TextRenderable(ctx, {
      content: t`${fg(colors.yellow)('⚙')}`,
    })
    toolHeader.add(toolIcon)

    const toolName = new TextRenderable(ctx, {
      content: t`${bold(fg(colors.cyan)(event.tool || 'Tool'))}`,
    })
    toolHeader.add(toolName)

    eventBox.add(toolHeader)

    // Tool args
    if (event.args) {
      const argsText = new TextRenderable(ctx, {
        content: t`${dim(fg(colors.textMuted)(`  Args: ${event.args}`))}`,
      })
      eventBox.add(argsText)
    }

    // Tool result
    if (event.result) {
      const resultText = new TextRenderable(ctx, {
        content: t`${dim(fg(colors.textMuted)(`  Result: ${event.result}`))}`,
      })
      eventBox.add(resultText)
    }
  } else if (event.type === 'code') {
    // Code block event
    const codeHeader = new TextRenderable(ctx, {
      content: t`${fg(colors.magenta)('{ }')} ${dim(fg(colors.textDim)(event.language || 'code'))}`,
    })
    eventBox.add(codeHeader)

    // Code block with syntax highlighting
    if (event.code) {
      const codeBlock = new CodeRenderable(ctx, {
        content: event.code,
        filetype: event.language || 'typescript',
        syntaxStyle: defaultSyntaxStyle,
        width: '100%',
        height: 'auto',
        padding: 1,
        margin: 0,
      })
      eventBox.add(codeBlock)
    }
  }

  return eventBox
}

function createMockSessionEvents(): SessionEvent[] {
  return [
    {
      type: 'message',
      content: 'Starting implementation of SessionView component...',
    },
    {
      type: 'message',
      content: 'Reading ProgressBar.ts to understand component pattern',
    },
    {
      type: 'tool',
      tool: 'Read',
      args: 'src/components/ProgressBar.ts',
      result: '(1365 bytes, 46 lines)',
    },
    {
      type: 'message',
      content: 'Analyzing existing views and components',
    },
    {
      type: 'tool',
      tool: 'Read',
      args: 'src/views/TicketView.ts',
      result: '(10624 bytes, 438 lines)',
    },
    {
      type: 'code',
      language: 'typescript',
      code: `import { BoxRenderable, TextRenderable } from '@opentui/core'
import { colors } from '../utils/colors.js'
import { createProgressBar } from '../components/ProgressBar.js'

export function createSessionView(ctx, props) {
  const container = new BoxRenderable(ctx, {
    width: '100%',
    height: '100%',
    flexDirection: 'column',
    backgroundColor: colors.bg,
  })
  // Implementation...
  return container
}`,
    },
    {
      type: 'message',
      content: 'Creating SessionView component with progress bar and session log',
    },
    {
      type: 'tool',
      tool: 'Write',
      args: 'src/views/SessionView.ts',
      result: '(created)',
    },
    {
      type: 'message',
      content: 'Running TypeScript type checking',
    },
    {
      type: 'tool',
      tool: 'Bash',
      args: '~/.bun/bin/bun run typecheck',
      result: 'All type checks passed',
    },
    {
      type: 'message',
      content: 'SessionView component successfully created and validated',
    },
  ]
}
