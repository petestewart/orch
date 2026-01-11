import {
  BoxRenderable,
  TextRenderable,
  ScrollBoxRenderable,
  t,
  fg,
  dim,
  type RenderContext,
} from '@opentui/core'
import { colors } from '../utils/colors.js'
import { renderChatInputContent } from '../utils/chat-input.js'
import type { ChatMessage } from '../state/types.js'

export interface ChatPanelProps {
  messages: ChatMessage[]
  onSendMessage?: (content: string) => void
  placeholder?: string
  isInputActive?: boolean
  currentInput?: string
  cursorIndex?: number
  onInputReady?: (lines: TextRenderable[]) => void
  inactiveInputColor?: string
}

export function createChatPanel(ctx: RenderContext, props: ChatPanelProps): BoxRenderable {
  const {
    messages,
    onSendMessage,
    placeholder = 'Type a message...',
    isInputActive = true,
    currentInput,
    cursorIndex = 0,
    inactiveInputColor = colors.textDim,
  } = props

  // Main container - vertical layout
  // ┌─────────────────────────────────────────────────────────────────┐
  // │ [Scrollable message area]                                       │
  // │                                                                  │
  // │ You: What should we build?                           12:45:00   │
  // │                                                                  │
  // │ Assistant: Let me help you plan the project...       12:45:15   │
  // │                                                                  │
  // ├─────────────────────────────────────────────────────────────────┤
  // │ Type a message... [input field]                                 │
  // └─────────────────────────────────────────────────────────────────┘

  const container = new BoxRenderable(ctx, {
    width: '100%',
    height: '100%',
    flexDirection: 'column',
    backgroundColor: colors.bg,
    border: true,
    borderStyle: 'single',
    borderColor: colors.border,
    padding: 1,
    gap: 1,
  })

  // Message scroll area
  const messageArea = new ScrollBoxRenderable(ctx, {
    width: '100%',
    flexGrow: 1,
    flexDirection: 'column',
    gap: 1,
    backgroundColor: colors.bgDark,
    padding: 1,
  })

  // Add messages to the scroll area
  messages.forEach((message) => {
    const messageBox = createMessageBox(ctx, message)
    messageArea.add(messageBox)
  })

  // Empty state if no messages
  if (messages.length === 0) {
    const emptyText = new TextRenderable(ctx, {
      content: t`${dim(fg(colors.textMuted)('No messages yet. Start the conversation!'))}`,
    })
    messageArea.add(emptyText)
  }

  container.add(messageArea)

  // Input wrapper with border
  const inputWrapper = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'column',
    backgroundColor: colors.activeBg,
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 0,
    paddingBottom: 0,
  })

  const value = currentInput ?? ''
  const { lines } = renderChatInputContent({
    text: value,
    cursorIndex,
    placeholder,
    isActive: isInputActive,
    inactiveColor: inactiveInputColor,
  })
  const lineRenderables = lines.map((content) => new TextRenderable(ctx, { content }))
  lineRenderables.forEach((line) => inputWrapper.add(line))
  if (props.onInputReady) {
    props.onInputReady(lineRenderables)
  }
  container.add(inputWrapper)

  return container
}

interface MessageBoxProps extends ChatMessage {}

function createMessageBox(ctx: RenderContext, message: ChatMessage): BoxRenderable {
  const messageBox = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'column',
    gap: 0,
    marginBottom: 1,
  })

  // Message header with role and timestamp
  const headerBox = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 0,
  })

  // Role label with color coding
  const roleColor = message.role === 'user' ? colors.cyan : colors.green
  const roleLabel = new TextRenderable(ctx, {
    content: t`${fg(roleColor)(message.role === 'user' ? 'You' : 'Assistant')}:`,
  })
  headerBox.add(roleLabel)

  // Timestamp
  const timestampText = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textDim)(message.timestamp))}`,
  })
  headerBox.add(timestampText)

  messageBox.add(headerBox)

  // Message content
  const contentColor = message.role === 'user' ? colors.text : colors.greenBright
  const contentText = new TextRenderable(ctx, {
    content: t`${fg(contentColor)(message.content)}`,
  })
  messageBox.add(contentText)

  return messageBox
}

// Helper to create mock messages for testing
export function createMockChatMessages(): ChatMessage[] {
  return [
    {
      id: '1',
      role: 'user',
      content: 'What features should we include in this project?',
      timestamp: '12:45:00',
    },
    {
      id: '2',
      role: 'assistant',
      content: 'Based on the requirements, I suggest implementing: user authentication, project dashboard, real-time notifications, and team collaboration features.',
      timestamp: '12:45:15',
    },
    {
      id: '3',
      role: 'user',
      content: 'Can we prioritize the dashboard and notifications first?',
      timestamp: '12:46:00',
    },
    {
      id: '4',
      role: 'assistant',
      content: 'Absolutely! I recommend creating tickets for dashboard components and setting up the notification system. This will give us a solid foundation for the other features.',
      timestamp: '12:46:30',
    },
  ]
}
