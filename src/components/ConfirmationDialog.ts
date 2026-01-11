/**
 * Confirmation Dialog Component
 *
 * Shows a modal dialog for confirming destructive actions.
 *
 * Implements: T029
 */

import { BoxRenderable, TextRenderable, t, fg, bg, type RenderContext } from '@opentui/core'
import { colors } from '../utils/colors.js'

export interface ConfirmationDialogProps {
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
}

export function createConfirmationDialog(ctx: RenderContext, props: ConfirmationDialogProps): BoxRenderable {
  // Overlay container that covers the entire screen
  const overlay = new BoxRenderable(ctx, {
    width: '100%',
    height: '100%',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  })

  // Dialog box
  const dialog = new BoxRenderable(ctx, {
    width: 50,
    flexDirection: 'column',
    backgroundColor: colors.bg,
    border: true,
    borderColor: colors.yellow,
    padding: 1,
  })

  // Title
  const title = new TextRenderable(ctx, {
    content: t`${fg(colors.yellow)(props.title)}`,
  })

  // Message
  const message = new TextRenderable(ctx, {
    content: t`${fg(colors.text)(props.message)}`,
  })

  // Spacer
  const spacer = new BoxRenderable(ctx, {
    height: 1,
  })

  // Button container
  const buttonContainer = new BoxRenderable(ctx, {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 2,
  })

  // Cancel button hint
  const cancelHint = new TextRenderable(ctx, {
    content: t`${bg(colors.borderDim)(fg(colors.textBold)(` Esc `))} ${fg(colors.textDim)(props.cancelLabel)}`,
  })

  // Confirm button hint
  const confirmHint = new TextRenderable(ctx, {
    content: t`${bg(colors.yellow)(fg(colors.bgDark)(` Enter `))} ${fg(colors.yellow)(props.confirmLabel)}`,
  })

  buttonContainer.add(cancelHint)
  buttonContainer.add(confirmHint)

  dialog.add(title)
  dialog.add(message)
  dialog.add(spacer)
  dialog.add(buttonContainer)

  overlay.add(dialog)

  return overlay
}
