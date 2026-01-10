import { BoxRenderable, TextRenderable, ScrollBoxRenderable, TabSelectRenderable, t, fg, bold, dim, type RenderContext, TabSelectRenderableEvents } from '@opentui/core'
import { colors } from '../utils/colors.js'

export interface DocPreviewProps {
  activeDoc: 'prd' | 'plan' | 'tickets'
  onDocChange?: (doc: 'prd' | 'plan' | 'tickets') => void
  isModified?: boolean
}

// Mock document content
const mockDocs = {
  prd: `# Product Requirements Document

## Overview
This document outlines the core requirements for the Agent Orchestrator system. The system is designed to manage and coordinate multiple AI agents working on a software development project.

## Key Features
- Agent lifecycle management
- Task assignment and tracking
- Project planning and execution
- Real-time status monitoring
- Multi-epic support

## User Interface
The UI provides a terminal-based dashboard with:
- Kanban board for task management
- Agent status panel
- Project planning view
- Logs and activity stream

## Success Criteria
- Agents can execute tasks autonomously
- Clear visibility into agent status
- Efficient task routing and assignment`,

  plan: `# Project Plan

## Phase 1: Core Infrastructure
- Setup project structure
- Initialize rendering framework
- Create base component system
- Implement state management

## Phase 2: Agent Management
- Create agent components
- Implement agent lifecycle
- Add agent status tracking
- Build agent view UI

## Phase 3: Task Management
- Create ticket system
- Implement Kanban board
- Add task assignment logic
- Build ticket refinement tools

## Phase 4: Integration & Polish
- Connect all components
- Add keyboard navigation
- Optimize performance
- Final testing and deployment`,

  tickets: `# Tickets

## T001: Setup Project Structure
Create initial project structure with TypeScript configuration and build tools.

## T002: Create Base Components
Build foundational UI components (Header, TabBar, etc.) for the terminal interface.

## T003: Implement State Management
Set up state store for managing application data and updates.

## T004: Create Kanban Board
Build the Kanban view with columns for different ticket statuses.

## T005: Add Agent Management
Create components for displaying and managing agents.

## T006: Implement Ticket Refinement
Add tools for planning and refining tickets before assignment.

## T007: Build Logs View
Create real-time activity logs and status updates display.

## T008: Add Keyboard Navigation
Implement keyboard shortcuts and navigation for all views.

## T009: Performance Optimization
Optimize rendering and data management for smooth experience.

## T010: Create DocPreview Component
Build document preview with tab switching and scrollable content display.`,
}

const DOC_OPTIONS = [
  { label: 'PRD.md', value: 'prd' as const },
  { label: 'PLAN.md', value: 'plan' as const },
  { label: 'TICKETS.md', value: 'tickets' as const },
]

export function createDocPreview(ctx: RenderContext, props: DocPreviewProps): BoxRenderable {
  const { activeDoc, onDocChange, isModified = false } = props

  // Main container
  const container = new BoxRenderable(ctx, {
    height: '100%',
    width: '100%',
    flexDirection: 'column',
    border: true,
    borderStyle: 'single',
    borderColor: colors.border,
    backgroundColor: colors.bg,
    padding: 1,
  })

  // Tab selector with title
  const headerBox = new BoxRenderable(ctx, {
    width: '100%',
    flexDirection: 'row',
    marginBottom: 1,
  })

  const titleText = new TextRenderable(ctx, {
    content: t`${bold(fg(colors.cyan)('Documents'))}`,
  })
  headerBox.add(titleText)
  container.add(headerBox)

  // Create tab options with modified indicator
  const tabOptions = DOC_OPTIONS.map(opt => ({
    name: `${opt.label}${isModified && opt.value === activeDoc ? '*' : ''}`,
    description: '',
    value: opt.value,
  }))

  const tabSelector = new TabSelectRenderable(ctx, {
    height: 1,
    width: '100%',
    options: tabOptions,
    tabWidth: 14,
    backgroundColor: colors.bg,
    textColor: colors.textDim,
    selectedBackgroundColor: colors.tabActive,
    selectedTextColor: colors.textBold,
    focusedBackgroundColor: colors.selectedBg,
    focusedTextColor: colors.text,
    showDescription: false,
    showUnderline: false,
    wrapSelection: false,
  })

  // Set initial selection
  const currentIndex = DOC_OPTIONS.findIndex(opt => opt.value === activeDoc)
  if (currentIndex >= 0) {
    tabSelector.setSelectedIndex(currentIndex)
  }

  // Handle tab changes
  if (onDocChange) {
    tabSelector.on(TabSelectRenderableEvents.SELECTION_CHANGED, () => {
      const selected = tabSelector.getSelectedOption()
      if (selected && selected.value) {
        onDocChange(selected.value as 'prd' | 'plan' | 'tickets')
      }
    })
  }

  container.add(tabSelector)

  // Scrollable content area
  const contentScroll = new ScrollBoxRenderable(ctx, {
    flexGrow: 1,
    width: '100%',
    marginTop: 1,
    padding: 0,
    flexDirection: 'column',
  })

  // Get the current document content
  const docContent = mockDocs[activeDoc]
  const lines = docContent.split('\n')

  // Add each line as a text element
  lines.forEach((line, index) => {
    // Determine text color based on content
    let textColor = colors.text
    if (line.startsWith('#')) {
      textColor = colors.cyan
    } else if (line.startsWith('- ') || line.startsWith('  - ')) {
      textColor = colors.text
    } else if (line.startsWith('##')) {
      textColor = colors.cyanBright
    } else if (line.trim() === '') {
      // Empty lines are still added for spacing
    }

    const lineText = new TextRenderable(ctx, {
      content: line.trim() === '' ? ' ' : t`${fg(textColor)(line)}`,
    })
    contentScroll.add(lineText)
  })

  // Empty state fallback
  if (lines.length === 0) {
    const emptyText = new TextRenderable(ctx, {
      content: t`${dim(fg(colors.textMuted)('No content'))}`,
    })
    contentScroll.add(emptyText)
  }

  container.add(contentScroll)

  return container
}
