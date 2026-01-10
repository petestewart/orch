import { BoxRenderable, TextRenderable, t, fg, type RenderContext } from '@opentui/core'
import { colors } from '../utils/colors.js'

export interface ProgressBarProps {
  progress: number // 0-100
  width?: number // Width in characters
  color?: string // Hex color code
}

export function createProgressBar(ctx: RenderContext, props: ProgressBarProps): BoxRenderable {
  const { progress, width = 20, color = colors.inProgress } = props

  // Clamp progress between 0 and 100
  const clampedProgress = Math.max(0, Math.min(100, progress))

  // Calculate filled portion
  const filledWidth = Math.round((clampedProgress / 100) * width)
  const emptyWidth = width - filledWidth

  // Create progress bar visualization using box-drawing characters
  const filledBar = '█'.repeat(filledWidth)
  const emptyBar = '░'.repeat(emptyWidth)
  const progressBar = filledBar + emptyBar

  // Container for progress bar
  const container = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'column',
    gap: 0,
  })

  // Progress bar with color
  const barText = new TextRenderable(ctx, {
    content: t`${fg(color)(progressBar)}`,
  })
  container.add(barText)

  // Percentage text below the bar
  const percentText = new TextRenderable(ctx, {
    content: t`${fg(color)(`${clampedProgress}%`)}`,
  })
  container.add(percentText)

  return container
}
