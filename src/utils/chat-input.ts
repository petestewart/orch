import { fg, t } from '@opentui/core'
import { colors } from './colors.js'

const CURSOR_TOKEN = '<<CURSOR>>'

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function layoutChatInput(text: string, cursorIndex: number, maxLines: number): { lines: string[]; lineCount: number } {
  const clampedCursor = clamp(cursorIndex, 0, text.length)
  const rawLines = text.split('\n')

  let remaining = clampedCursor
  let cursorLine = 0
  let cursorCol = 0
  for (let i = 0; i < rawLines.length; i += 1) {
    const lineLength = rawLines[i].length
    if (remaining <= lineLength) {
      cursorLine = i
      cursorCol = remaining
      break
    }
    remaining -= lineLength + 1
  }

  const linesWithCursor = [...rawLines]
  const targetLine = linesWithCursor[cursorLine] ?? ''
  linesWithCursor[cursorLine] = `${targetLine.slice(0, cursorCol)}${CURSOR_TOKEN}${targetLine.slice(cursorCol)}`

  const maxVisible = Math.max(1, maxLines)
  const start = clamp(cursorLine - Math.floor(maxVisible / 2), 0, Math.max(0, linesWithCursor.length - maxVisible))
  const visibleLines = linesWithCursor.slice(start, start + maxVisible)
  return { lines: visibleLines, lineCount: Math.max(1, visibleLines.length) }
}

function formatLine(prompt: string, line: string, textColor: string, showCursor: boolean): any {
  const safeLine = showCursor ? line : line.replace(CURSOR_TOKEN, '')
  const parts = safeLine.split(CURSOR_TOKEN)
  if (parts.length === 1) {
    return t`${fg(colors.cyan)(prompt)}${fg(textColor)(parts[0])}`
  }
  return t`${fg(colors.cyan)(prompt)}${fg(textColor)(parts[0])}${fg(colors.cyan)('█')}${fg(textColor)(parts[1])}`
}

/**
 * Render chat input in fallback single-line mode (no multiline support).
 * T041: Fallback mode for when multiline rendering fails.
 */
function renderChatInputFallback(options: {
  text: string
  placeholder: string
  isActive: boolean
  inactiveColor: string
  prompt?: string
}): { lines: object[]; lineCount: number } {
  const {
    text,
    placeholder,
    isActive,
    inactiveColor,
    prompt = '> ',
  } = options

  const hasValue = text.length > 0
  const textColor = isActive ? colors.text : inactiveColor

  // In fallback mode, strip newlines from the display
  const displayText = hasValue ? text.replace(/\n/g, '↵') : placeholder
  const line = isActive && hasValue ? `${displayText}▌` : displayText

  return {
    lines: [t`${fg(colors.cyan)(prompt)}${fg(textColor)(line)}`],
    lineCount: 1,
  }
}

export function renderChatInputContent(options: {
  text: string
  cursorIndex: number
  maxLines?: number
  placeholder: string
  isActive: boolean
  inactiveColor: string
  prompt?: string
  multilineMode?: boolean // T041: Enable multiline mode (default: true)
}): { lines: any[]; lineCount: number } {
  const {
    text,
    cursorIndex,
    maxLines = 4,
    placeholder,
    isActive,
    inactiveColor,
    prompt = '> ',
    multilineMode = true,
  } = options

  const hasValue = text.length > 0
  const textColor = isActive ? colors.text : inactiveColor

  // T041: Use fallback single-line mode if disabled
  if (!multilineMode) {
    return renderChatInputFallback({
      text,
      placeholder,
      isActive,
      inactiveColor,
      prompt,
    })
  }

  if (!hasValue) {
    const line = isActive ? `${CURSOR_TOKEN}${placeholder}` : placeholder
    return {
      lines: [formatLine(prompt, line, colors.textMuted, isActive)],
      lineCount: 1,
    }
  }

  const { lines, lineCount } = layoutChatInput(text, cursorIndex, maxLines)
  const formatted = lines.map((line) => formatLine(prompt, line, textColor, isActive))
  return { lines: formatted, lineCount }
}
