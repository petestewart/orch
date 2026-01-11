/**
 * Manual Ticket Creation Dialog
 *
 * T039: Allows users to create new tickets via TUI
 */

import {
  BoxRenderable,
  TextRenderable,
  t,
  fg,
  bold,
  dim,
  type RenderContext,
} from '@opentui/core'
import { colors } from '../utils/colors.js'
import type { Priority } from '../state/types.js'

export interface TicketCreateDialogProps {
  isOpen: boolean
  title: string
  description: string
  priority: Priority
  epic: string
  acceptanceCriteria: string[]
  dependencies: string[]
  currentField: 'title' | 'description' | 'priority' | 'epic' | 'acceptanceCriteria' | 'dependencies'
  onFieldChange?: (field: string, value: string | string[]) => void
  onSave?: () => void
  onCancel?: () => void
}

export function createTicketCreateDialog(ctx: RenderContext, props: TicketCreateDialogProps): BoxRenderable | null {
  if (!props.isOpen) return null

  const {
    title,
    description,
    priority,
    epic,
    acceptanceCriteria,
    dependencies,
    currentField,
  } = props

  // Semi-transparent overlay background
  const overlay = new BoxRenderable(ctx, {
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    position: 'absolute',
    zIndex: 1000,
  })

  // Dialog container
  const dialog = new BoxRenderable(ctx, {
    width: 80,
    height: 25,
    flexDirection: 'column',
    backgroundColor: colors.bgDark,
    border: true,
    borderStyle: 'double',
    borderColor: colors.cyan,
    padding: 1,
    gap: 1,
    position: 'absolute',
    zIndex: 1001,
    // Center it (rough calculation)
  })

  // Title
  const titleText = new TextRenderable(ctx, {
    content: t`${bold(fg(colors.cyan)('Create New Ticket'))}`,
  })
  dialog.add(titleText)

  // Help text
  const helpText = new TextRenderable(ctx, {
    content: t`${dim(fg(colors.textMuted)('Tab: next field  S-Tab: prev  Ctrl+S: save  Esc: cancel'))}`,
  })
  dialog.add(helpText)

  // Title field
  const titleFieldLabel = new TextRenderable(ctx, {
    content: t`${fg(currentField === 'title' ? colors.cyan : colors.text)('Title:')}`,
  })
  dialog.add(titleFieldLabel)

  const titleFieldValue = new TextRenderable(ctx, {
    content: t`${fg(colors.green)(title || '(empty)')}${currentField === 'title' ? fg(colors.cyan)('▌') : ''}`,
  })
  dialog.add(titleFieldValue)

  // Description field
  const descFieldLabel = new TextRenderable(ctx, {
    content: t`${fg(currentField === 'description' ? colors.cyan : colors.text)('Description:')}`,
  })
  dialog.add(descFieldLabel)

  const descFieldValue = new TextRenderable(ctx, {
    content: t`${fg(colors.green)(description || '(empty)')}${currentField === 'description' ? fg(colors.cyan)('▌') : ''}`,
  })
  dialog.add(descFieldValue)

  // Priority field
  const priorityFieldLabel = new TextRenderable(ctx, {
    content: t`${fg(currentField === 'priority' ? colors.cyan : colors.text)('Priority:')}`,
  })
  dialog.add(priorityFieldLabel)

  const priorityFieldValue = new TextRenderable(ctx, {
    content: t`${fg(colors.green)(priority)}${currentField === 'priority' ? fg(colors.cyan)('▌') : ''} ${dim(fg(colors.textMuted)('(P1/P2/P3)'))}`,
  })
  dialog.add(priorityFieldValue)

  // Epic field
  const epicFieldLabel = new TextRenderable(ctx, {
    content: t`${fg(currentField === 'epic' ? colors.cyan : colors.text)('Epic:')}`,
  })
  dialog.add(epicFieldLabel)

  const epicFieldValue = new TextRenderable(ctx, {
    content: t`${fg(colors.green)(epic || '(none)')}${currentField === 'epic' ? fg(colors.cyan)('▌') : ''}`,
  })
  dialog.add(epicFieldValue)

  // Acceptance Criteria field
  const acFieldLabel = new TextRenderable(ctx, {
    content: t`${fg(currentField === 'acceptanceCriteria' ? colors.cyan : colors.text)('Acceptance Criteria:')}`,
  })
  dialog.add(acFieldLabel)

  const acDisplay = acceptanceCriteria.length > 0
    ? acceptanceCriteria.map(ac => `  • ${ac}`).join('\n')
    : '  (none)'
  const acFieldValue = new TextRenderable(ctx, {
    content: t`${fg(colors.green)(acDisplay)}${currentField === 'acceptanceCriteria' ? fg(colors.cyan)('▌') : ''}`,
  })
  dialog.add(acFieldValue)

  // Dependencies field
  const depsFieldLabel = new TextRenderable(ctx, {
    content: t`${fg(currentField === 'dependencies' ? colors.cyan : colors.text)('Dependencies:')}`,
  })
  dialog.add(depsFieldLabel)

  const depsDisplay = dependencies.length > 0
    ? dependencies.join(', ')
    : '(none)'
  const depsFieldValue = new TextRenderable(ctx, {
    content: t`${fg(colors.green)(depsDisplay)}${currentField === 'dependencies' ? fg(colors.cyan)('▌') : ''}`,
  })
  dialog.add(depsFieldValue)

  // Action buttons
  const buttonsBox = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 2,
    marginTop: 1,
  })

  const saveBtn = new TextRenderable(ctx, {
    content: t`${fg(colors.green)('[Ctrl+S] Save')}`,
  })
  buttonsBox.add(saveBtn)

  const cancelBtn = new TextRenderable(ctx, {
    content: t`${fg(colors.red)('[Esc] Cancel')}`,
  })
  buttonsBox.add(cancelBtn)

  dialog.add(buttonsBox)

  return dialog
}
