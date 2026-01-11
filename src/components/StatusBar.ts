import { BoxRenderable, TextRenderable, t, fg, bg, type RenderContext } from '@opentui/core'
import { colors } from '../utils/colors.js'
import type { AppState } from '../state/types.js'

interface ShortcutDef {
  key: string
  label: string
  requiresCtrlInInputMode?: boolean
}

const GLOBAL_SHORTCUTS: ShortcutDef[] = [
  { key: '1-5', label: 'tabs' },
  { key: '?', label: 'help' },
  { key: 'q', label: 'quit' },
]

const VIEW_SHORTCUTS: Record<AppState['currentView'], ShortcutDef[]> = {
  kanban: [
    { key: 'j/k', label: 'nav' },
    { key: 'h/l', label: 'columns' },
    { key: 'Enter', label: 'open' },
    { key: 'e', label: 'epic filter' },
    { key: 'a', label: 'approve' },
    { key: 'r', label: 'reject' },
    { key: 't', label: 'takeover' },
    { key: 'p', label: 'pause' },
  ],
  plan: [
    { key: 'Tab', label: 'switch pane', requiresCtrlInInputMode: false },
    { key: 'i', label: 'input', requiresCtrlInInputMode: false },
    { key: 'Esc', label: 'command', requiresCtrlInInputMode: false },
    { key: 'Enter', label: 'send', requiresCtrlInInputMode: false },
    { key: 'Shift+Enter', label: 'newline', requiresCtrlInInputMode: false },
  ],
  refine: [
    { key: 'j/k', label: 'tickets' },
    { key: 'Tab', label: 'switch pane', requiresCtrlInInputMode: false },
    { key: 'i', label: 'input', requiresCtrlInInputMode: false },
    { key: 'Esc', label: 'command', requiresCtrlInInputMode: false },
    { key: 'y', label: 'accept' },
    { key: 'n', label: 'reject' },
    { key: 'Shift+Enter', label: 'newline', requiresCtrlInInputMode: false },
  ],
  agents: [
    { key: 'j/k', label: 'nav' },
    { key: 'Enter', label: 'view session' },
    { key: 's', label: 'stop' },
    { key: 'r', label: 'restart' },
  ],
  logs: [
    { key: 'j/k', label: 'scroll' },
    { key: 'f', label: 'filter' },
    { key: '/', label: 'search' },
    { key: 'c', label: 'clear' },
  ],
}

export interface StatusBarProps {
  currentView: AppState['currentView']
  pendingApprovalsCount?: number
  totalCost?: number // T025: Cost Tracking
  chatPaneActive?: boolean
  chatInputMode?: boolean
  ctrlPrefixShortcuts?: boolean
}

function formatShortcutKey(shortcut: ShortcutDef, ctrlPrefixShortcuts?: boolean): string {
  if (ctrlPrefixShortcuts && shortcut.requiresCtrlInInputMode !== false) {
    return `^${shortcut.key}`
  }
  return shortcut.key
}

export function createStatusBar(ctx: RenderContext, props: StatusBarProps): BoxRenderable {
  const statusBar = new BoxRenderable(ctx, {
    height: 1,
    width: '100%',
    flexDirection: 'row',
    backgroundColor: colors.bgDark,
    paddingLeft: 1,
    paddingRight: 1,
    gap: 2,
  })

  // Show total cost if > 0 (T025: Cost Tracking)
  if (props.totalCost !== undefined && props.totalCost > 0) {
    const costText = new TextRenderable(ctx, {
      content: t`${bg(colors.cyan)(fg(colors.bgDark)(` $${props.totalCost.toFixed(2)} `))}`,
    })
    statusBar.add(costText)
  }

  if (props.chatPaneActive) {
    const label = props.chatInputMode ? 'INPUT' : 'CMD'
    const indicatorColor = props.chatInputMode ? colors.green : colors.yellow
    const chatMode = new TextRenderable(ctx, {
      content: t`${bg(indicatorColor)(fg(colors.bgDark)(` ${label} `))}`,
    })
    statusBar.add(chatMode)
  }

  // Show pending approvals count if > 0 (T029)
  if (props.pendingApprovalsCount && props.pendingApprovalsCount > 0) {
    const pendingText = new TextRenderable(ctx, {
      content: t`${bg(colors.yellow)(fg(colors.bgDark)(` ${props.pendingApprovalsCount} pending `))}`,
    })
    statusBar.add(pendingText)
  }

  // Build shortcut text - create individual text elements for each shortcut
  const viewShortcuts = (VIEW_SHORTCUTS[props.currentView] || []).filter((shortcut) => {
    if (!props.chatPaneActive) {
      return true
    }

    if (props.currentView !== 'plan' && props.currentView !== 'refine') {
      return true
    }

    if (shortcut.key !== 'i' && shortcut.key !== 'Esc') {
      return true
    }

    if (props.chatInputMode && shortcut.key === 'i') {
      return false
    }

    if (!props.chatInputMode && shortcut.key === 'Esc') {
      return false
    }

    return true
  })
  const allShortcuts = [...viewShortcuts, ...GLOBAL_SHORTCUTS]

  for (const shortcut of allShortcuts) {
    const shortcutKey = formatShortcutKey(shortcut, props.ctrlPrefixShortcuts)
    const shortcutText = new TextRenderable(ctx, {
      content: t`${bg(colors.borderDim)(fg(colors.textBold)(` ${shortcutKey} `))} ${fg(colors.textDim)(shortcut.label)}`,
    })
    statusBar.add(shortcutText)
  }

  return statusBar
}
