import {
  BoxRenderable,
  type RenderContext,
  type TextRenderable,
} from '@opentui/core'
import { colors } from '../utils/colors.js'
import { createChatPanel } from '../components/ChatPanel.js'
import { createDocPreview } from '../components/DocPreview.js'
import type { Store } from '../state/store.js'
import type { ChatMessage } from '../state/types.js'

export interface PlanViewProps {
  store: Store
  activePane: 'chat' | 'docs'
  activeDoc: 'prd' | 'plan' | 'tickets'
  onPaneChange?: (pane: 'chat' | 'docs') => void
  onDocChange?: (doc: 'prd' | 'plan' | 'tickets') => void
  onSendMessage?: (content: string) => void
  planContent?: string // Custom PLAN.md content to display
  onChatInputReady?: (lines: TextRenderable[]) => void
}

export function createPlanView(ctx: RenderContext, props: PlanViewProps): BoxRenderable {
  const { store, activePane, activeDoc, onPaneChange, onDocChange, onSendMessage, planContent, onChatInputReady } = props

  // Main container - horizontal layout for two columns
  // ┌─ Chat (60%) ─────────────────────┬─ Documents (40%) ────────────┐
  // │ [ChatPanel component]            │ [DocPreview component]       │
  // │                                   │                               │
  // │                                   │                               │
  // └───────────────────────────────────┴───────────────────────────────┘

  const container = new BoxRenderable(ctx, {
    width: '100%',
    height: '100%',
    flexDirection: 'row',
    backgroundColor: colors.bg,
    gap: 0,
    padding: 0,
  })

  // Left pane: ChatPanel (60%)
  const chatPaneContainer = new BoxRenderable(ctx, {
    width: '60%',
    height: '100%',
    flexDirection: 'column',
    backgroundColor: colors.bg,
    padding: 0,
  })

  // Get chat messages from store
  const messages = store.getPlanViewChatMessages()

  // Create welcome message if no messages yet
  const displayMessages: ChatMessage[] = messages.length > 0 ? messages : [
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Welcome to the Plan View! I can help you edit and refine your project plan. Ask me to:\n\n- Create new tickets\n- Modify existing tickets\n- Analyze dependencies\n- Suggest improvements\n\nHow can I help you today?',
      timestamp: getTimestamp(),
    }
  ]

  const chatPanel = createChatPanel(ctx, {
    messages: displayMessages,
    placeholder: 'Type your planning question...',
    onSendMessage: onSendMessage,
    isInputActive: store.getState().planViewChatInputMode && activePane === 'chat',
    currentInput: store.getState().planViewChatInput,
    cursorIndex: store.getState().planViewChatCursor,
    inactiveInputColor: colors.textDim,
    onInputReady: onChatInputReady,
  })
  chatPaneContainer.add(chatPanel)

  // Right pane: DocPreview (40%)
  const docPaneContainer = new BoxRenderable(ctx, {
    width: '40%',
    height: '100%',
    flexDirection: 'column',
    backgroundColor: colors.bg,
    padding: 0,
  })

  const docPreview = createDocPreview(ctx, {
    activeDoc,
    isModified: false,
    customPlanContent: planContent,
    onDocChange: (doc) => {
      if (onDocChange) {
        onDocChange(doc)
      }
    },
  })
  docPaneContainer.add(docPreview)

  // Add both panes to container
  container.add(chatPaneContainer)
  container.add(docPaneContainer)

  return container
}

/**
 * Get current timestamp in HH:MM:SS format
 */
function getTimestamp(): string {
  const now = new Date()
  const hours = now.getHours().toString().padStart(2, '0')
  const minutes = now.getMinutes().toString().padStart(2, '0')
  const seconds = now.getSeconds().toString().padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}
