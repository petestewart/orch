import { BoxRenderable, TextRenderable, t, fg, bold, dim, type RenderContext } from '@opentui/core'
import { colors } from '../utils/colors.js'

export interface HeaderProps {
  epicNames: string[]
  selectedEpicIds: string[]
}

export function createHeader(ctx: RenderContext, props: HeaderProps): BoxRenderable {
  const header = new BoxRenderable(ctx, {
    height: 1,
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.bgDark,
    paddingLeft: 1,
    paddingRight: 1,
  })

  // App title
  const title = new TextRenderable(ctx, {
    content: t`${bold(fg(colors.cyan)('ORCH'))} ${dim(fg(colors.textDim)('Agent Orchestrator'))}`,
  })

  // Epic selector display
  const epicText = props.selectedEpicIds.length > 0
    ? props.epicNames.join(' + ')
    : 'No epics selected'

  const epicSelector = new TextRenderable(ctx, {
    content: t`${fg(colors.textDim)('Epic:')} ${fg(colors.yellow)(epicText)} ${dim(fg(colors.textMuted)('[e]'))}`,
  })

  header.add(title)
  header.add(epicSelector)

  return header
}
