/**
 * Help Overlay Component
 *
 * Shows a modal overlay with all keyboard shortcuts for the current view.
 * Toggle with '?' key (Ctrl+? or Ctrl+/ in chat), close with Escape.
 *
 * Implements: T019
 */

import { BoxRenderable, TextRenderable, t, fg, bg, dim, type RenderContext } from '@opentui/core'
import { colors } from '../utils/colors.js'
import type { AppState } from '../state/types.js'

interface ShortcutDef {
  key: string
  label: string
  requiresCtrlInInputMode?: boolean
}

const GLOBAL_SHORTCUTS: ShortcutDef[] = [
  { key: '1-5', label: 'Switch tabs (Ctrl+1-5 in chat input mode)' },
  { key: '?', label: 'Toggle help (Ctrl+? or Ctrl+/ in chat input mode)' },
  { key: 'q', label: 'Quit application (Ctrl+q in chat input mode, Ctrl+C outside input mode)' },
  { key: 'Esc', label: 'Close overlay / Go back' },
]

const VIEW_SHORTCUTS: Record<AppState['currentView'], ShortcutDef[]> = {
  kanban: [
    { key: 'j / Down', label: 'Navigate down in column' },
    { key: 'k / Up', label: 'Navigate up in column' },
    { key: 'h / Left', label: 'Move to left column' },
    { key: 'l / Right', label: 'Move to right column' },
    { key: 'Enter', label: 'Open ticket details' },
    { key: 'e', label: 'Cycle epic filter' },
    { key: 's', label: 'Start agent on ready ticket' },
    { key: 'a', label: 'Approve ticket (Review/QA)' },
    { key: 'r', label: 'Reject ticket (Review/QA)' },
    { key: 't', label: 'Take over ticket (manual mode)' },
    { key: 'p', label: 'Pause/resume automation' },
  ],
  plan: [
    { key: 'Tab', label: 'Switch between chat and docs pane', requiresCtrlInInputMode: false },
    { key: 'i', label: 'Enter input mode (chat)', requiresCtrlInInputMode: false },
    { key: 'Esc', label: 'Command mode (chat)', requiresCtrlInInputMode: false },
    { key: 'h / Left', label: 'Previous document (in docs pane)' },
    { key: 'l / Right', label: 'Next document (in docs pane)' },
    { key: 'Enter', label: 'Send message (in chat)', requiresCtrlInInputMode: false },
    { key: 'Shift+Enter', label: 'New line (in chat)', requiresCtrlInInputMode: false },
    { key: 'Arrows', label: 'Move cursor (in chat)', requiresCtrlInInputMode: false },
  ],
  refine: [
    { key: 'j / Down', label: 'Navigate down in list (sidebar/audit)' },
    { key: 'k / Up', label: 'Navigate up in list (sidebar/audit)' },
    { key: 'Tab', label: 'Switch between panes', requiresCtrlInInputMode: false },
    { key: 'i', label: 'Enter input mode (chat)', requiresCtrlInInputMode: false },
    { key: 'Esc', label: 'Command mode (chat)', requiresCtrlInInputMode: false },
    { key: 'Ctrl+J / Ctrl+K', label: 'Navigate proposals (chat)' },
    { key: 'Ctrl+Space', label: 'Toggle proposal selection (chat)' },
    { key: 'Ctrl+C', label: 'Create selected proposals (chat)' },
    { key: 'Ctrl+E', label: 'Edit selected proposal (chat)' },
    { key: 'Ctrl+Shift+A', label: 'Run plan audit (chat)' },
    { key: 'Shift+A', label: 'Run plan audit (sidebar/audit)' },
    { key: 'y', label: 'Accept suggestion' },
    { key: 'n', label: 'Reject suggestion' },
    { key: 'Shift+Enter', label: 'New line (in chat)', requiresCtrlInInputMode: false },
    { key: 'Arrows', label: 'Move cursor (in chat)', requiresCtrlInInputMode: false },
  ],
  agents: [
    { key: 'j / Down', label: 'Navigate down in agent list' },
    { key: 'k / Up', label: 'Navigate up in agent list' },
    { key: 'Enter', label: 'View agent session' },
    { key: 'x', label: 'Stop selected agent' },
    { key: 's', label: 'Stop agent' },
    { key: 'r', label: 'Restart agent' },
  ],
  logs: [
    { key: 'j / Down', label: 'Scroll down in logs' },
    { key: 'k / Up', label: 'Scroll up in logs' },
    { key: 'l', label: 'Cycle level filter' },
    { key: 'a', label: 'Cycle agent filter' },
    { key: 't', label: 'Cycle ticket filter' },
    { key: 's', label: 'Toggle auto-scroll' },
    { key: 'c', label: 'Clear all filters' },
    { key: '/', label: 'Search logs' },
  ],
}

const VIEW_TITLES: Record<AppState['currentView'], string> = {
  plan: 'Epic Planning',
  refine: 'Backlog Refinement',
  kanban: 'Kanban Board',
  agents: 'Agent Management',
  logs: 'System Logs',
}

export interface HelpOverlayProps {
  currentView: AppState['currentView']
  chatPaneActive?: boolean
  chatInputMode?: boolean
}

function formatShortcutKey(shortcut: ShortcutDef, ctrlPrefixShortcuts?: boolean): string {
  if (!ctrlPrefixShortcuts || shortcut.requiresCtrlInInputMode === false) {
    return shortcut.key
  }

  if (shortcut.key.startsWith('Ctrl+')) {
    return shortcut.key
  }

  return `^${shortcut.key}`
}

function shouldShowShortcut(
  shortcut: ShortcutDef,
  props: HelpOverlayProps
): boolean {
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
}

export function createHelpOverlay(ctx: RenderContext, props: HelpOverlayProps): BoxRenderable {
  // Semi-transparent overlay container that covers the entire screen
  const overlay = new BoxRenderable(ctx, {
    width: '100%',
    height: '100%',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  })

  // Main dialog box
  const dialog = new BoxRenderable(ctx, {
    width: 60,
    flexDirection: 'column',
    backgroundColor: colors.bg,
    border: true,
    borderColor: colors.cyan,
    padding: 1,
  })

  // Title
  const title = new TextRenderable(ctx, {
    content: t`${fg(colors.cyan)('Keyboard Shortcuts')}`,
  })
  dialog.add(title)

  // Spacer
  const titleSpacer = new BoxRenderable(ctx, { height: 1 })
  dialog.add(titleSpacer)

  // View-specific section
  const viewTitle = new TextRenderable(ctx, {
    content: t`${fg(colors.textBold)(VIEW_TITLES[props.currentView])}`,
  })
  dialog.add(viewTitle)

  // View shortcuts
  const viewShortcuts = VIEW_SHORTCUTS[props.currentView] || []
  for (const shortcut of viewShortcuts) {
    if (!shouldShowShortcut(shortcut, props)) {
      continue
    }
    const shortcutRow = createShortcutRow(ctx, shortcut, props)
    dialog.add(shortcutRow)
  }

  // Spacer before global shortcuts
  const sectionSpacer = new BoxRenderable(ctx, { height: 1 })
  dialog.add(sectionSpacer)

  // Global section title
  const globalTitle = new TextRenderable(ctx, {
    content: t`${fg(colors.textBold)('Global')}`,
  })
  dialog.add(globalTitle)

  // Global shortcuts
  for (const shortcut of GLOBAL_SHORTCUTS) {
    const shortcutRow = createShortcutRow(ctx, shortcut, props)
    dialog.add(shortcutRow)
  }

  // Spacer before close hint
  const closeSpacer = new BoxRenderable(ctx, { height: 1 })
  dialog.add(closeSpacer)

  // Close hint
  const closeHint = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textDim)('Press '))}${bg(colors.borderDim)(fg(colors.textBold)(' Esc '))}${dim(fg(colors.textDim)(' or '))}${bg(colors.borderDim)(fg(colors.textBold)(' ? '))}${dim(fg(colors.textDim)(' to close'))}`,
  })
  dialog.add(closeHint)

  overlay.add(dialog)

  return overlay
}

function createShortcutRow(
  ctx: RenderContext,
  shortcut: ShortcutDef,
  props: HelpOverlayProps
): BoxRenderable {
  const row = new BoxRenderable(ctx, {
    flexDirection: 'row',
    width: '100%',
    paddingLeft: 1,
  })

  // Key column (fixed width)
  const shortcutKey = formatShortcutKey(shortcut, props.chatPaneActive && props.chatInputMode)
  const keyText = new TextRenderable(ctx, {
    content: t`${bg(colors.borderDim)(fg(colors.textBold)(` ${shortcutKey.padEnd(12)} `))}`,
  })

  // Label column
  const labelText = new TextRenderable(ctx, {
    content: t` ${fg(colors.text)(shortcut.label)}`,
  })

  row.add(keyText)
  row.add(labelText)

  return row
}
