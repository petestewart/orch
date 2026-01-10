import { TabSelectRenderable, type RenderContext, TabSelectRenderableEvents } from '@opentui/core'
import { colors } from '../utils/colors.js'
import type { AppState } from '../state/types.js'

export type ViewName = AppState['currentView']

const VIEW_OPTIONS: { name: ViewName; label: string }[] = [
  { name: 'plan', label: 'Plan' },
  { name: 'refine', label: 'Refine' },
  { name: 'kanban', label: 'Kanban' },
  { name: 'agents', label: 'Agents' },
  { name: 'logs', label: 'Logs' },
]

export interface TabBarProps {
  currentView: ViewName
  onViewChange: (view: ViewName) => void
}

export function createTabBar(ctx: RenderContext, props: TabBarProps): TabSelectRenderable {
  const currentIndex = VIEW_OPTIONS.findIndex(v => v.name === props.currentView)

  const tabBar = new TabSelectRenderable(ctx, {
    height: 1,
    width: '100%',
    options: VIEW_OPTIONS.map((v, i) => ({
      name: `${i + 1} ${v.label}`,
      description: '',
      value: v.name,
    })),
    tabWidth: 12,
    backgroundColor: colors.bgDark,
    textColor: colors.textDim,
    selectedBackgroundColor: colors.tabActive,
    selectedTextColor: colors.textBold,
    focusedBackgroundColor: colors.selectedBg,
    focusedTextColor: colors.text,
    showDescription: false,
    showUnderline: false,
    wrapSelection: true,
  })

  tabBar.setSelectedIndex(currentIndex >= 0 ? currentIndex : 2) // Default to Kanban

  tabBar.on(TabSelectRenderableEvents.SELECTION_CHANGED, () => {
    const selected = tabBar.getSelectedOption()
    if (selected && selected.value) {
      props.onViewChange(selected.value as ViewName)
    }
  })

  return tabBar
}

export function getViewByNumber(num: number): ViewName | null {
  if (num >= 1 && num <= VIEW_OPTIONS.length) {
    return VIEW_OPTIONS[num - 1].name
  }
  return null
}
