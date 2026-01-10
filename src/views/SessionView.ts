/**
 * SessionView - Live Agent Output Display
 *
 * Shows real-time agent output with:
 * - Streaming stdout display
 * - Tool call parsing and highlighting
 * - Progress bar based on output parsing
 * - Elapsed time
 * - Scrollable with j/k, auto-scroll toggle
 *
 * Implements: T015
 */

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
import {
  parseAgentOutput,
  extractToolCalls,
  type ParsedOutput,
} from '../core/agent-manager.js'
import { getEventBus } from '../core/events.js'
import type { AgentProgressEvent } from '../core/types.js'

// Create a default syntax style for code blocks
const defaultSyntaxStyle = SyntaxStyle.create()

export interface SessionViewProps {
  agent?: Agent
  ticket: Ticket
  agentOutput?: string // Accumulated agent output for streaming
  autoScroll?: boolean // Whether to auto-scroll to bottom
  onAutoScrollToggle?: () => void // Callback when auto-scroll is toggled
}

export interface SessionEvent {
  type: 'message' | 'tool' | 'code' | 'output'
  content?: string
  tool?: string
  args?: string
  result?: string
  language?: string
  code?: string
  timestamp?: Date
}

/**
 * Tool color mapping for visual distinction
 */
const TOOL_COLORS: Record<string, string> = {
  Read: colors.cyan,
  Write: colors.green,
  Edit: colors.green,
  Bash: colors.yellow,
  Grep: colors.magenta,
  Glob: colors.magenta,
  WebFetch: colors.blue,
  WebSearch: colors.blue,
  TodoWrite: colors.yellowBright,
  NotebookEdit: colors.greenBright,
  default: colors.textDim,
}

/**
 * Get color for a tool name
 */
function getToolColor(toolName: string): string {
  return TOOL_COLORS[toolName] || TOOL_COLORS.default
}

/**
 * Format elapsed time from Date to human-readable string
 */
function formatElapsedTime(startedAt?: Date): string {
  if (!startedAt) return '0s'
  const elapsed = Date.now() - startedAt.getTime()
  const seconds = Math.floor(elapsed / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
}

/**
 * Parse agent output into displayable session events
 * Extracts tool calls, messages, and code blocks
 */
export function parseOutputToEvents(output: string): SessionEvent[] {
  const events: SessionEvent[] = []
  const toolCalls = extractToolCalls(output)

  // Add tool call events
  for (const toolCall of toolCalls) {
    const args = toolCall.args
      ? Object.entries(toolCall.args)
          .map(([k, v]) => `${k}: ${String(v).slice(0, 100)}`)
          .join(', ')
      : undefined

    events.push({
      type: 'tool',
      tool: toolCall.tool,
      args,
      timestamp: new Date(),
    })
  }

  // Also add raw output lines as messages (limited for performance)
  const lines = output.split('\n').filter((line) => line.trim().length > 0)
  const recentLines = lines.slice(-50) // Show last 50 lines

  for (const line of recentLines) {
    // Skip lines that look like tool invocations (we handle those above)
    if (
      line.match(/Using\s+\w+\s+tool/i) ||
      line.match(/<invoke name=/) ||
      line.match(/Reading\s+/) ||
      line.match(/Writing\s+/)
    ) {
      continue
    }

    // Check if this is a code block marker
    if (line.startsWith('```')) {
      continue
    }

    // Add as message event
    events.push({
      type: 'output',
      content: line.slice(0, 200), // Limit line length
      timestamp: new Date(),
    })
  }

  return events
}

/**
 * Main SessionView component
 * Shows real-time agent output with progress and tool highlighting
 */
export function createSessionView(
  ctx: RenderContext,
  props: SessionViewProps
): BoxRenderable {
  const { agent, ticket, agentOutput = '', autoScroll = true } = props

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
  const progressSection = createProgressSection(ctx, {
    agent,
    output: agentOutput,
    ticketId: ticket.id,
  })
  container.add(progressSection)

  // Auto-scroll indicator
  const scrollIndicator = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textDim)(`Auto-scroll: ${autoScroll ? 'ON' : 'OFF'} (press 'a' to toggle)`))}`,
  })
  container.add(scrollIndicator)

  // Session log area - scrollable
  const sessionLog = new ScrollBoxRenderable(ctx, {
    width: '100%',
    flexGrow: 1,
    flexDirection: 'column',
    gap: 1,
  })

  // Parse output into events if we have agent output
  let sessionEvents: SessionEvent[]
  if (agentOutput && agentOutput.length > 0) {
    sessionEvents = parseOutputToEvents(agentOutput)
  } else {
    // Show placeholder when no output yet
    sessionEvents = [
      {
        type: 'message',
        content: agent
          ? 'Waiting for agent output...'
          : 'No agent assigned to this ticket yet.',
      },
    ]
  }

  // Add session events to log
  sessionEvents.forEach((event) => {
    const eventElement = createSessionEventElement(ctx, event)
    sessionLog.add(eventElement)
  })

  container.add(sessionLog)

  // Status bar at bottom showing key bindings
  const statusBar = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 2,
    padding: 1,
    border: true,
    borderStyle: 'single',
    borderColor: colors.borderDim,
    backgroundColor: colors.bgDark,
  })

  const keybindingsText = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textDim)('j/k: scroll'))} ${dim(fg(colors.textDim)('|'))} ${dim(fg(colors.textDim)('a: auto-scroll'))} ${dim(fg(colors.textDim)('|'))} ${dim(fg(colors.textDim)('q: back'))}`,
  })
  statusBar.add(keybindingsText)

  // Show tool call count
  const toolCalls = extractToolCalls(agentOutput)
  const toolCountText = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textDim)(`Tools: ${toolCalls.length}`))}`,
  })
  statusBar.add(toolCountText)

  container.add(statusBar)

  return container
}

interface ProgressSectionProps {
  agent?: Agent
  output: string
  ticketId: string
}

/**
 * Creates the progress section header with agent info, elapsed time, and progress bar
 */
function createProgressSection(
  ctx: RenderContext,
  props: ProgressSectionProps
): BoxRenderable {
  const { agent, output, ticketId } = props

  // Parse output to get progress estimate
  const parsedOutput: ParsedOutput = output
    ? parseAgentOutput(output)
    : { isComplete: false, isBlocked: false, toolCalls: [], progress: 0 }

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

  if (agent) {
    const agentInfoText = new TextRenderable(ctx, {
      content: t`${bold(fg(colors.text)(agent.name))} ${dim(fg(colors.textDim)(`(${agent.model})`))}`,
    })
    headerBox.add(agentInfoText)

    const elapsedText = new TextRenderable(ctx, {
      content: t`${dim(fg(colors.textDim)(`Elapsed: ${agent.elapsed}`))}`,
    })
    headerBox.add(elapsedText)
  } else {
    const ticketText = new TextRenderable(ctx, {
      content: t`${bold(fg(colors.text)(`Ticket: ${ticketId.toUpperCase()}`))} ${dim(fg(colors.textDim)('(no agent assigned)'))}`,
    })
    headerBox.add(ticketText)
  }

  section.add(headerBox)

  // Progress bar - use parsed progress from output
  const progress = agent?.progress ?? parsedOutput.progress
  const progressBar = createProgressBar(ctx, {
    progress,
    width: 30,
    color: parsedOutput.isComplete
      ? colors.green
      : parsedOutput.isBlocked
        ? colors.red
        : colors.inProgress,
  })
  section.add(progressBar)

  // Status and phase info
  const statusBox = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 2,
  })

  // Determine status label
  let statusLabel = 'Starting'
  let statusColor = colors.textDim
  if (parsedOutput.isComplete) {
    statusLabel = 'Complete'
    statusColor = colors.green
  } else if (parsedOutput.isBlocked) {
    statusLabel = 'Blocked'
    statusColor = colors.red
  } else if (agent) {
    statusLabel = agent.status === 'working' ? 'Working' : agent.status
    statusColor =
      agent.status === 'working'
        ? colors.working
        : agent.status === 'waiting'
          ? colors.waiting
          : colors.idle
  }

  const statusText = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textDim)('Status:'))} ${fg(statusColor)(statusLabel)}`,
  })
  statusBox.add(statusText)

  // Show tokens if available
  if (agent) {
    const tokensText = new TextRenderable(ctx, {
      content: t`${dim(fg(colors.textDim)(`Tokens: ${agent.tokensIn}/${agent.tokensOut}`))}`,
    })
    statusBox.add(tokensText)

    const costText = new TextRenderable(ctx, {
      content: t`${dim(fg(colors.textDim)(`Cost: $${agent.cost.toFixed(4)}`))}`,
    })
    statusBox.add(costText)
  }

  section.add(statusBox)

  // Show blocked reason if present
  if (parsedOutput.isBlocked && parsedOutput.blockReason) {
    const blockedReasonText = new TextRenderable(ctx, {
      content: t`${fg(colors.red)('Blocked:')} ${fg(colors.text)(parsedOutput.blockReason)}`,
    })
    section.add(blockedReasonText)
  }

  return section
}

/**
 * Creates a single session event element (message, tool call, or code block)
 */
function createSessionEventElement(
  ctx: RenderContext,
  event: SessionEvent
): BoxRenderable {
  const eventBox = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'column',
    gap: 0,
    padding: 1,
  })

  if (event.type === 'message' || event.type === 'output') {
    // Message/output event - simple text display
    const icon = event.type === 'output' ? '│' : '→'
    const color = event.type === 'output' ? colors.textDim : colors.cyan
    const messageText = new TextRenderable(ctx, {
      content: t`${fg(color)(icon)} ${fg(colors.text)(event.content || '')}`,
    })
    eventBox.add(messageText)
  } else if (event.type === 'tool') {
    // Tool call event with colored highlighting
    const toolColor = getToolColor(event.tool || '')

    // Tool header with icon and name
    const toolHeader = new BoxRenderable(ctx, {
      width: '100%',
      flexDirection: 'row',
      gap: 1,
    })

    // Use different icons for different tool types
    const icon = getToolIcon(event.tool || '')
    const toolIcon = new TextRenderable(ctx, {
      content: t`${fg(toolColor)(icon)}`,
    })
    toolHeader.add(toolIcon)

    const toolName = new TextRenderable(ctx, {
      content: t`${bold(fg(toolColor)(event.tool || 'Tool'))}`,
    })
    toolHeader.add(toolName)

    eventBox.add(toolHeader)

    // Tool args with truncation
    if (event.args) {
      const argsText = new TextRenderable(ctx, {
        content: t`${dim(fg(colors.textMuted)(`  ${event.args.slice(0, 150)}${event.args.length > 150 ? '...' : ''}`))}`,
      })
      eventBox.add(argsText)
    }

    // Tool result if present
    if (event.result) {
      const resultText = new TextRenderable(ctx, {
        content: t`${dim(fg(colors.textMuted)(`  → ${event.result}`))}`,
      })
      eventBox.add(resultText)
    }
  } else if (event.type === 'code') {
    // Code block event with syntax highlighting
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

/**
 * Get an appropriate icon for a tool type
 */
function getToolIcon(toolName: string): string {
  const icons: Record<string, string> = {
    Read: '[R]',
    Write: '[W]',
    Edit: '[E]',
    Bash: '[$]',
    Grep: '[/]',
    Glob: '[*]',
    WebFetch: '[F]',
    WebSearch: '[S]',
    TodoWrite: '[T]',
    NotebookEdit: '[N]',
  }
  return icons[toolName] || '[?]'
}

/**
 * State class for managing session view with live updates
 * This can be used by the parent component to manage output accumulation
 */
export class SessionViewState {
  private outputBuffer: string = ''
  private unsubscribe: (() => void) | null = null
  private autoScroll: boolean = true
  private scrollPosition: number = 0

  constructor(private agentId?: string) {
    if (agentId) {
      this.subscribeToAgent(agentId)
    }
  }

  /**
   * Subscribe to agent progress events to accumulate output
   */
  subscribeToAgent(agentId: string): void {
    this.agentId = agentId
    const eventBus = getEventBus()

    this.unsubscribe = eventBus.subscribe<AgentProgressEvent>(
      'agent:progress',
      (event) => {
        if (event.agentId === this.agentId && event.lastAction) {
          // Append new output to buffer
          this.outputBuffer += event.lastAction + '\n'
        }
      }
    )
  }

  /**
   * Get the current accumulated output
   */
  getOutput(): string {
    return this.outputBuffer
  }

  /**
   * Append output directly (for manual feeding)
   */
  appendOutput(content: string): void {
    this.outputBuffer += content
  }

  /**
   * Clear the output buffer
   */
  clearOutput(): void {
    this.outputBuffer = ''
  }

  /**
   * Toggle auto-scroll
   */
  toggleAutoScroll(): void {
    this.autoScroll = !this.autoScroll
  }

  /**
   * Get auto-scroll state
   */
  getAutoScroll(): boolean {
    return this.autoScroll
  }

  /**
   * Set scroll position
   */
  setScrollPosition(position: number): void {
    this.scrollPosition = position
  }

  /**
   * Get scroll position
   */
  getScrollPosition(): number {
    return this.scrollPosition
  }

  /**
   * Scroll up (j key)
   */
  scrollUp(lines: number = 1): void {
    this.scrollPosition = Math.max(0, this.scrollPosition - lines)
    this.autoScroll = false // Disable auto-scroll when manually scrolling
  }

  /**
   * Scroll down (k key)
   */
  scrollDown(lines: number = 1): void {
    this.scrollPosition += lines
  }

  /**
   * Clean up subscription
   */
  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }
  }
}

/**
 * Export types for external use
 */
export type { ParsedOutput }
