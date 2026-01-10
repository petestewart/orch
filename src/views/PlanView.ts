import {
  BoxRenderable,
  type RenderContext,
} from '@opentui/core'
import { colors } from '../utils/colors.js'
import { createChatPanel, createMockChatMessages } from '../components/ChatPanel.js'
import { createDocPreview } from '../components/DocPreview.js'

export interface PlanViewProps {
  activePane: 'chat' | 'docs'
  activeDoc: 'prd' | 'plan' | 'tickets'
  onPaneChange?: (pane: 'chat' | 'docs') => void
  onDocChange?: (doc: 'prd' | 'plan' | 'tickets') => void
}

export function createPlanView(ctx: RenderContext, props: PlanViewProps): BoxRenderable {
  const { activePane, activeDoc, onPaneChange, onDocChange } = props

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

  // Create ChatPanel with mock messages
  const mockMessages = createMockChatMessages()
  const chatPanel = createChatPanel(ctx, {
    messages: mockMessages,
    placeholder: 'Type your planning question...',
    onSendMessage: (content) => {
      // Mock handler for sending messages
      console.log('Message sent:', content)
    },
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
