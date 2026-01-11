import { BoxRenderable, TextRenderable, t, fg, bg, type RenderContext } from '@opentui/core'
import { colors } from '../utils/colors.js'
import type { AppState } from '../state/types.js'

interface ShortcutDef {
  key: string
  label: string
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
    { key: 'Tab', label: 'switch pane' },
    { key: 'Enter', label: 'send' },
  ],
  refine: [
    { key: 'j/k', label: 'tickets' },
    { key: 'Tab', label: 'switch pane' },
    { key: 'y', label: 'accept' },
    { key: 'n', label: 'reject' },
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

  // Show pending approvals count if > 0 (T029)
  if (props.pendingApprovalsCount && props.pendingApprovalsCount > 0) {
    const pendingText = new TextRenderable(ctx, {
      content: t`${bg(colors.yellow)(fg(colors.bgDark)(` ${props.pendingApprovalsCount} pending `))}`,
    })
    statusBar.add(pendingText)
  }

  // Build shortcut text - create individual text elements for each shortcut
  const viewShortcuts = VIEW_SHORTCUTS[props.currentView] || []
  const allShortcuts = [...viewShortcuts, ...GLOBAL_SHORTCUTS]

  for (const shortcut of allShortcuts) {
    const shortcutText = new TextRenderable(ctx, {
      content: t`${bg(colors.borderDim)(fg(colors.textBold)(` ${shortcut.key} `))} ${fg(colors.textDim)(shortcut.label)}`,
    })
    statusBar.add(shortcutText)
  }

  return statusBar
}
