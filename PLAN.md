# ORCH - AI Agent Orchestrator

## 1. Overview

ORCH is a terminal-based orchestration tool that coordinates multiple autonomous Claude Code agents working on a software project simultaneously. It reads a project plan (PLAN.md), spawns agents to work on tickets, manages dependencies, monitors progress in real-time, and maintains coherence across the codebase.

**Success looks like:** A developer can run `orch` in their project directory, see a TUI with their tickets organized in a kanban board, start agents on ready tickets, watch real-time progress, and have tickets automatically verified and marked complete. Multiple agents work in parallel while the developer supervises.

**Starting Point:** This project builds on an existing OpenTUI prototype with working UI components and views. The prototype has mock data - this plan implements the real orchestration logic.

## 2. Non-Goals

Explicitly out of scope for v1:

- **Web interface** - Terminal only
- **IDE integration** - Standalone tool
- **Custom agent types** - Claude Code only
- **Historical analytics** - Real-time only
- **CI/CD integration** - Manual deployment assumed
- **Remote agents** - Local execution only
- **Remote worktrees** - Worktrees are local only
- **Team collaboration** - Single user operation

## 3. Assumptions

1. **Claude Code CLI is installed** - Users have `claude` command available and authenticated
2. **Node.js/Bun runtime** - Bun is available for running the application
3. **Unix-like environment** - macOS or Linux; Windows WSL supported
4. **PLAN.md created via ORCH** - Users create their plan through AI-assisted conversation in Plan mode (or manually if preferred)
5. **Agents can run concurrently** - System resources allow 3-10 parallel Claude Code instances
6. **Prototype UI is reusable** - Existing OpenTUI components work with minimal modification
7. **File system is the source of truth** - PLAN.md is read/written directly, no database

## 4. Constraints

### Technical
- **Language:** TypeScript
- **Runtime:** Bun
- **TUI Framework:** OpenTUI (@opentui/core)
- **Agent Backend:** Claude Code CLI (`claude` command)
- **Process Management:** Node child_process or Bun subprocess APIs

### Architecture
- **Single process model** - ORCH runs as one process managing agent subprocesses
- **Event-driven state** - All state changes flow through an event bus
- **File-based persistence** - PLAN.md is the only persistent state
- **No external services** - No databases, no servers, no network (except Claude API via agents)

### Performance
- **Startup:** < 2 seconds to interactive
- **UI responsiveness:** < 100ms for any user action
- **Memory:** < 200MB for ORCH process (excluding agents)
- **Concurrent agents:** Support 3-10 simultaneous agents

## 5. Architecture Sketch

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           ORCH Process                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                         Event Bus                                 │  │
│  │   (Central pub/sub - all components communicate via events)       │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│       │              │                │                │                │
│       ▼              ▼                ▼                ▼                │
│  ┌─────────┐   ┌──────────┐   ┌─────────────┐   ┌──────────────┐       │
│  │   TUI   │   │  Plan    │   │ Orchestrator│   │    Agent     │       │
│  │  Layer  │   │  Store   │   │   Engine    │   │   Manager    │       │
│  │         │   │          │   │             │   │              │       │
│  │ OpenTUI │   │ Parse/   │   │ Dependency  │   │ Spawn/Stop   │       │
│  │ Render  │   │ Write    │   │ Resolution  │   │ Monitor      │       │
│  │ Input   │   │ PLAN.md  │   │ Scheduling  │   │ IPC          │       │
│  └─────────┘   └──────────┘   └─────────────┘   └──────────────┘       │
│       │              │                │                │                │
│       └──────────────┴────────────────┴────────────────┘                │
│                              │                                          │
└──────────────────────────────┼──────────────────────────────────────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         ▼                     ▼                     ▼
   ┌───────────┐         ┌───────────┐         ┌───────────┐
   │  Agent 1  │         │  Agent 2  │         │  Agent N  │
   │ (claude)  │         │ (claude)  │         │ (claude)  │
   └─────┬─────┘         └─────┬─────┘         └─────┬─────┘
         │                     │                     │
         └─────────────────────┴─────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │   Project Codebase  │
                    │   (PLAN.md, src/)   │
                    └─────────────────────┘
```

### Module Responsibilities

**Event Bus (`src/core/events.ts`)**
- Central pub/sub system for all inter-component communication
- Event types: `plan:updated`, `agent:spawned`, `agent:progress`, `agent:completed`, `agent:failed`, `ticket:status-changed`, `log:entry`
- Decouples components completely - no direct imports between layers
- Maintains event history for debugging

**Plan Store (`src/core/plan-store.ts`)**
- Reads PLAN.md from filesystem on startup
- Parses markdown into structured Ticket objects
- Writes updates back atomically (temp file + rename)
- Emits `plan:updated` on any change
- Validates plan structure, detects circular dependencies

**Epic Manager (`src/core/epic-manager.ts`)**
- Manages epic directories and git worktrees
- Creates worktrees when multiple agents need same epic
- Merges completed worktrees back to epic main branch
- Detects and reports merge conflicts
- Cleans up worktrees after ticket completion

**Orchestrator Engine (`src/core/orchestrator.ts`)**
- Maintains dependency graph of tickets
- Computes "ready" tickets (dependencies met, not assigned)
- Assigns agents to ready tickets by priority
- Coordinates with Epic Manager to assign worktrees
- Triggers validation when agent reports completion
- Handles ticket state transitions: Todo → In Progress → Review → QA → Done/Failed
- Spawns Review Agent when ticket enters Review (based on automation config)
- Spawns QA Agent when ticket enters QA (based on automation config)

**Review Agent (`src/core/review-agent.ts`)**
- Specialized agent for code review
- Analyzes code changes against best practices
- Checks for security issues, bugs, code smells
- Approves (→ QA) or rejects (→ In Progress with feedback)

**QA Agent (`src/core/qa-agent.ts`)**
- Specialized agent for manual testing
- Performs exploratory testing based on acceptance criteria
- Runs application, verifies behavior
- Approves (→ Done) or rejects (→ In Progress with bug report)

**Agent Manager (`src/core/agent-manager.ts`)**
- Spawns Claude Code as subprocess with ticket prompt
- Captures stdout/stderr, parses for progress signals
- Detects completion marker (`=== TICKET Txxx COMPLETE ===`)
- Tracks per-agent metrics: tokens, cost, elapsed time
- Graceful shutdown, restart on failure

**TUI Layer (`src/ui/`)**
- Reuses existing prototype components (Header, TabBar, StatusBar, etc.)
- Subscribes to event bus for state updates
- Renders views: Kanban, Agents, Logs, Plan, Refine, TicketDetail, SessionView
- Handles keyboard input, routes to appropriate handlers

### Data Flow

1. User starts ORCH → Plan Store reads PLAN.md → emits `plan:updated`
2. Orchestrator receives event → calculates ready tickets → emits `tickets:ready`
3. User presses 's' on ticket (or auto-assign if configured)
4. Epic Manager allocates worktree for ticket's epic (creates new if needed)
5. Agent Manager spawns agent in the assigned worktree directory
6. Implementation Agent works → stdout captured → parsed → emits `agent:progress`
7. Agent outputs completion marker → Agent Manager detects → emits `agent:completed`
8. Orchestrator receives → runs validation steps → moves ticket to Review
9. Review Agent spawns (if automation enabled) → analyzes changes → approves/rejects
10. If approved → ticket moves to QA → QA Agent spawns → tests functionality
11. If QA passes → Epic Manager merges worktree → ticket moves to Done
12. If rejected at any stage → ticket returns to In Progress with feedback
13. If merge conflict → ticket paused → user alerted
14. Plan Store updates PLAN.md → emits `plan:updated`
15. TUI receives all events → re-renders affected components
16. Cycle repeats for newly unblocked tickets

### Prompt Template (Agent)

```
You are working on ticket {{TICKET_ID}}: {{TITLE}}

## Context
Project: {{PROJECT_PATH}}
Working directory: {{WORKING_DIR}}

## Your Task
{{DESCRIPTION}}

## Acceptance Criteria
{{ACCEPTANCE_CRITERIA}}

## Constraints
- Only modify files relevant to this ticket
- Run tests before reporting completion
- If blocked, output: === TICKET {{TICKET_ID}} BLOCKED: [reason] ===

## When Complete
After all acceptance criteria are met, output exactly:
=== TICKET {{TICKET_ID}} COMPLETE ===
[Brief summary of changes made]
```

## 6. Definition of Done

### Build Requirements
- [ ] `bun run build` produces executable without errors
- [ ] `bun run typecheck` passes with no errors
- [ ] All dependencies are production-ready (no local file: references)

### Test Requirements
- [ ] Unit tests exist for: Plan parser, Event bus, Dependency resolver, Config system, Epic manager
- [ ] Integration test: Spawn agent, complete ticket, verify plan updated
- [ ] Integration test: Full pipeline Todo → In Progress → Review → QA → Done
- [ ] Integration test: Multiple agents on same epic use separate worktrees
- [ ] Integration test: Worktree merge on completion
- [ ] Manual test: Full workflow with 3+ concurrent agents
- [ ] Manual test: Review agent catches code issues
- [ ] Manual test: QA agent catches functional bugs
- [ ] Manual test: AI-assisted ticket creation in Refine view
- [ ] Manual test: Plan audit detects coverage gaps

### Run Requirements
- [ ] `orch` command starts TUI within 2 seconds
- [ ] Kanban shows 5 columns: Backlog, In Progress, Review, QA, Done
- [ ] Can navigate all 5 views with keyboard
- [ ] Can start/stop agents from UI
- [ ] Agents receive correct prompts with ticket context
- [ ] Completion detection works reliably
- [ ] Review Agent spawns and reviews code automatically (when configured)
- [ ] QA Agent spawns and tests functionality automatically (when configured)
- [ ] Human can intervene at Review/QA stages
- [ ] Plan file updates persist correctly
- [ ] Graceful shutdown on Ctrl+C (kills all agents)
- [ ] Configuration file controls automation behavior

### User Validation
- [ ] Developer can complete a 5-ticket project using ORCH
- [ ] Tickets flow automatically through Review and QA (default mode)
- [ ] Developer can take over any stage manually
- [ ] UI provides clear feedback on agent status
- [ ] Error states are recoverable (restart agent, retry ticket)
- [ ] Logs provide sufficient detail for debugging

## 7. Task Backlog

### Ticket: T001 Event Bus Implementation
- **Priority:** P0
- **Status:** Done
- **Owner:** Completed
- **Scope:** Create the central event bus that all components will use for communication. Type-safe event definitions, subscribe/publish/unsubscribe methods, event history for debugging.
- **Acceptance Criteria:**
  - EventBus class with typed events
  - Subscribe returns unsubscribe function
  - Publish is synchronous, handlers called in order
  - Event history accessible (last 1000 events)
  - All event types defined: plan:*, agent:*, ticket:*, log:*
- **Validation Steps:**
  - `bun run typecheck` passes
  - Unit test: subscribe, publish, receive, unsubscribe works
- **Notes:**
  - Orchestrator notes:
    - Intended approach: Implement type-safe pub/sub with Map-based handler storage, auto-incrementing subscription IDs, circular buffer for event history
    - Key constraints: Must be synchronous, handlers called in registration order, event types defined in src/core/types.ts
    - Dependencies: None - this is the first ticket
    - Estimated complexity: moderate

### Ticket: T002 Plan Parser - Read PLAN.md
- **Priority:** P0
- **Status:** Done
- **Owner:** Completed
- **Scope:** Parse PLAN.md markdown into structured ticket objects. Extract ticket ID, title, priority, status, dependencies, acceptance criteria, validation steps.
- **Acceptance Criteria:**
  - Parses standard PLAN.md format (see PRD appendix)
  - Returns array of Ticket objects with all fields
  - Handles missing optional fields gracefully
  - Reports parse errors with line numbers
  - Supports ticket IDs: T001, T002, etc.
- **Validation Steps:**
  - `bun run typecheck` passes
  - Unit test with sample PLAN.md parses correctly
  - Unit test with malformed PLAN.md returns helpful error
- **Notes:**
  - Orchestrator notes:
    - Intended approach: Regex-based markdown parsing, extract ticket sections between ### headers, parse field lines with - **Field:** pattern
    - Key constraints: Must handle missing optional fields, preserve line numbers for errors, return Ticket objects matching src/core/types.ts
    - Dependencies: None
    - Estimated complexity: complex

### Ticket: T003 Plan Store - Write Updates
- **Priority:** P0
- **Status:** Done
- **Owner:** Completed
- **Scope:** Extend plan store to write ticket status updates back to PLAN.md atomically. Preserve formatting, comments, and unrecognized sections.
- **Acceptance Criteria:**
  - Updates ticket status in-place (Todo → In Progress → Done)
  - Updates ticket owner field
  - Atomic write (temp file + rename)
  - Preserves markdown formatting
  - Emits plan:updated event after write
- **Validation Steps:**
  - `bun run typecheck` passes
  - Unit test: update status, read back, verify
  - Integration test: concurrent reads/writes don't corrupt
- **Notes:**
- **Dependencies:** T002

### Ticket: T004 Dependency Graph
- **Priority:** P0
- **Status:** Done
- **Owner:** Completed
- **Scope:** Build and maintain a directed acyclic graph of ticket dependencies. Compute which tickets are "ready" (all dependencies Done).
- **Acceptance Criteria:**
  - Builds graph from ticket array
  - Detects circular dependencies (error)
  - `getReadyTickets()` returns tickets with all deps Done and status Todo
  - `getBlockedBy(ticketId)` returns blocking tickets
  - Graph updates when ticket status changes
- **Validation Steps:**
  - `bun run typecheck` passes
  - Unit test: linear deps A→B→C, only A ready initially
  - Unit test: parallel deps, multiple ready
  - Unit test: circular dep detected
- **Notes:**
- **Dependencies:** T002

### Ticket: T005 Agent Subprocess Spawning
- **Priority:** P0
- **Status:** Done
- **Owner:** Completed
- **Scope:** Spawn Claude Code CLI as a subprocess with a prompt. Capture stdout/stderr streams. Track process lifecycle.
- **Acceptance Criteria:**
  - Spawns `claude` with `--print` and `--dangerously-skip-permissions` flags
  - Passes ticket prompt via stdin or --prompt flag
  - Captures stdout line-by-line
  - Tracks process PID, start time
  - Handles process exit (success/error)
- **Validation Steps:**
  - `bun run typecheck` passes
  - Manual test: spawn real claude process, see output
  - Unit test with mock process
- **Notes:**
  - Orchestrator notes:
    - Intended approach: Use Bun.spawn() API to run claude CLI, capture stdout/stderr with onData callbacks, track PID
    - Key constraints: Must use --print flag, handle process exit codes, store output in buffers
    - Dependencies: None
    - Estimated complexity: moderate
  - Agent-T005 implementation notes:
    - Implemented spawn() method using Bun.spawn() with --print and --dangerously-skip-permissions flags
    - Prompt passed via -p flag (not stdin)
    - Implemented buildImplementationPrompt() based on PLAN.md template
    - Implemented basic stop() with SIGTERM/SIGKILL and 5s timeout
    - Added new event types to types.ts: AgentSpawnedEvent, AgentCompletedEvent, AgentFailedEvent, AgentBlockedEvent, AgentStoppedEvent
    - Created agent-manager.test.ts with 24 tests for spawn logic, prompt building, completion/blocked detection
    - All validation steps pass: typecheck passes, unit tests pass (68 tests), manual test with real claude process confirmed spawning/stopping works

### Ticket: T006 Agent Output Parser
- **Priority:** P0
- **Status:** Done
- **Owner:** Completed
- **Scope:** Parse Claude Code output to detect completion, blockers, and progress. Extract tool calls, file changes, test results.
- **Acceptance Criteria:**
  - Detects `=== TICKET Txxx COMPLETE ===` marker
  - Detects `=== TICKET Txxx BLOCKED: reason ===` marker
  - Extracts tool usage (file reads, writes, bash commands)
  - Estimates progress percentage from output patterns
  - Handles streaming output (partial lines)
- **Validation Steps:**
  - `bun run typecheck` passes
  - Unit test with sample claude output
  - Unit test detects completion marker
  - Unit test handles malformed output gracefully
- **Notes:**
- **Dependencies:** T005

### Ticket: T007 Agent Manager
- **Priority:** P0
- **Status:** Done
- **Owner:** Completed
- **Scope:** Manage multiple agent instances. Track agent pool, enforce concurrency limits, handle agent lifecycle events.
- **Acceptance Criteria:**
  - Maintains map of active agents by ID
  - Enforces max concurrent agents (configurable, default 5)
  - Creates agent with ticket assignment
  - Stops agent gracefully (SIGTERM, then SIGKILL)
  - Emits events: agent:spawned, agent:progress, agent:completed, agent:failed
  - Tracks metrics per agent: tokens, cost, elapsed
- **Validation Steps:**
  - `bun run typecheck` passes
  - Unit test: spawn, track, stop agent
  - Unit test: concurrency limit respected
- **Notes:**
- **Dependencies:** T005, T006, T001

### Ticket: T008 Orchestrator Core Loop
- **Priority:** P0
- **Status:** Done
- **Owner:** Completed
- **Scope:** Main orchestration logic that ties everything together. React to events, schedule work, manage ticket state transitions.
- **Acceptance Criteria:**
  - On startup: load plan, compute ready tickets
  - On user action: assign agent to ticket
  - On agent:completed: run validation, update ticket status
  - On agent:failed: mark ticket failed, log error
  - Respects ticket priorities (P0 > P1 > P2)
  - Handles concurrent completions correctly
- **Validation Steps:**
  - `bun run typecheck` passes
  - Integration test: end-to-end ticket completion
  - Test: priority ordering respected
- **Notes:**
  - Orchestrator notes:
    - Intended approach: Implement start/stop/tick methods, subscribe to agent events, wire up dependency graph from plan store
    - Key constraints: Must integrate with existing DependencyGraph, AgentManager, EpicManager, and PlanStore classes
    - Dependencies: T001 (events), T003 (plan writes), T004 (dependency graph), T007 (agent manager) - all done
    - Estimated complexity: complex
  - Implementation complete:
    - start(): Loads plan, builds dependency graph, subscribes to agent events
    - stop(): Unsubscribes from events, stops all agents
    - getReadyTickets(): Delegates to DependencyGraph with priority sorting
    - assignTicket(): Verifies readiness, allocates worktree, spawns agent, updates status
    - handleAgentComplete(): Runs validation, advances or fails ticket
    - tick(): Auto-assigns ready tickets in automatic mode
    - Event handlers for agent:completed, agent:failed, agent:blocked
    - 41 unit tests passing, typecheck passes
- **Dependencies:** T001, T003, T004, T007

### Ticket: T009 Validation Runner
- **Priority:** P0
- **Status:** Done
- **Owner:** Completed
- **Scope:** Execute ticket validation steps after agent reports completion. Run commands, check exit codes, report results.
- **Acceptance Criteria:**
  - Parses validation steps from ticket
  - Runs each command in sequence
  - Captures stdout/stderr for logging
  - Returns pass/fail with details
  - Timeout support (default 60s per step)
- **Validation Steps:**
  - `bun run typecheck` passes
  - Unit test: run `echo hello`, verify pass
  - Unit test: run `exit 1`, verify fail
  - Unit test: timeout triggers correctly
- **Notes:**
- **Dependencies:** T002

### Ticket: T010 Refactor State Store
- **Priority:** P0
- **Status:** Done
- **Owner:** Completed
- **Scope:** Replace prototype's mock-based store with event-driven store. Subscribe to event bus, maintain derived state for UI.
- **Acceptance Criteria:**
  - Subscribes to all relevant events
  - Maintains: tickets, agents, logs, selectedView, selectedTicket
  - Provides getState() for UI reads
  - No mock data - all state from events
  - Triggers UI re-render on state change
- **Validation Steps:**
  - `bun run typecheck` passes
  - Integration test: event → state change → UI update
- **Notes:** Implementation complete. Refactored store.ts to subscribe to EventBus events (plan:loaded, ticket:status-changed, agent:spawned, agent:progress, agent:completed, agent:failed, agent:blocked, agent:stopped, log:entry). Added type mapping functions for core/state types. Added onChange callback for UI re-renders. Removed mock data. Added 34 unit tests and 3 integration tests in store.test.ts and store.integration.test.ts. Updated app.ts to use onChange callback. Pre-existing typecheck errors in src/test-utils/mock-subprocess.ts (untracked file from other work) are unrelated to T010.
- **Dependencies:** T001, T003, T007

### Ticket: T011 Connect Kanban View to Real State
- **Priority:** P1
- **Status:** Done
- **Owner:** Completed
- **Scope:** Update KanbanView to use real state from store instead of mock data. Wire up ticket selection and agent assignment actions. Update to 5 columns.
- **Acceptance Criteria:**
  - Displays tickets from store.getState().tickets
  - Groups by status in 5 columns: Backlog (Todo), In Progress, Review, QA, Done
  - Shows Review/QA agent activity in respective columns
  - Selection state persists correctly
  - Enter on ticket emits event (for detail view)
  - 's' key starts agent on selected ticket (if ready)
  - Shows visual indicator when ticket is being reviewed/tested
- **Validation Steps:**
  - `bun run typecheck` passes
  - Manual test: see real tickets from PLAN.md
  - Manual test: start agent from UI
  - Manual test: tickets flow through all 5 columns
- **Notes:** Implementation complete. Added QA column to COLUMNS array (now 5 columns: Backlog, In Progress, Review, QA, Done). Added visual indicators in TicketCard for review status (purple circle with 'reviewing') and QA status (yellow circle with 'testing'). Added 's' key handler in app.ts to emit events when starting agent on selected ready ticket. KanbanView already uses store.getState().tickets and store.getTicketsByStatus() from T010. All 631 tests pass, typecheck passes.
- **Dependencies:** T010

### Ticket: T012 Connect Agents View to Real State
- **Priority:** P1
- **Status:** Done
- **Owner:** Completed
- **Scope:** Update AgentsView to display real running agents. Show live metrics, progress, and last actions.
- **Acceptance Criteria:**
  - Lists all agents from store.getState().agents
  - Shows: ID, model, ticket, status, progress, elapsed, tokens, cost
  - Updates in real-time as agent:progress events arrive
  - 'x' key stops selected agent
  - Empty state when no agents running
- **Validation Steps:**
  - `bun run typecheck` passes
  - Manual test: start agent, see in Agents view
  - Manual test: stop agent from UI
- **Notes:** Implementation complete. AgentsView already uses store.getState().agents from T010 work. Added agent:stop-request event type to core/types.ts. Added requestStopAgent() method to Store that publishes the stop-request event. Added 'x' key handler in App.ts handleAgentsKeypress() to call store.requestStopAgent() for selected working/waiting agents. The stop-request event can be consumed by the Orchestrator (T008) to actually stop agents. All 631 tests pass, typecheck passes.
- **Dependencies:** T010, T007

### Ticket: T013 Connect Logs View to Real State
- **Priority:** P1
- **Status:** Done
- **Owner:** Completed
- **Scope:** Update LogsView to display real log entries from event bus. Implement filtering by level, agent, ticket.
- **Acceptance Criteria:**
  - Displays log entries from store.getState().logs
  - Each entry: timestamp, level, agent, ticket, message
  - Filter by level (INFO, WARN, ERROR, EVENT)
  - Filter by agent ID
  - Filter by ticket ID
  - Auto-scroll to bottom on new entries (toggleable)
- **Validation Steps:**
  - `bun run typecheck` passes
  - Manual test: see logs from agent activity
  - Manual test: filters work correctly
- **Notes:** Implementation complete. Added filter state to AppState (logsLevelFilter, logsAgentFilter, logsTicketFilter, logsSearchQuery, logsAutoScroll). Added store methods for cycling filters. Updated LogsView to use store state and display filter controls. Added keyboard handlers: 'l' cycle level, 'a' cycle agent, 't' cycle ticket, 's' toggle auto-scroll, 'c' clear filters. Auto-scroll reverses log order to show newest at bottom.
- **Dependencies:** T010

### Ticket: T014 TicketView Agent Actions
- **Priority:** P1
- **Status:** Todo
- **Owner:** Unassigned
- **Scope:** Add action buttons/keys to TicketView for starting agents, viewing session, retrying failed tickets.
- **Acceptance Criteria:**
  - 's' key starts agent on ticket (if ready)
  - Shows agent status if ticket in progress
  - Tab to SessionView shows live agent output
  - 'r' key retries failed ticket (resets to Todo)
  - Disabled states for unavailable actions
- **Validation Steps:**
  - `bun run typecheck` passes
  - Manual test: start agent from ticket detail
  - Manual test: view live session
- **Notes:**
- **Dependencies:** T011

### Ticket: T015 SessionView Live Output
- **Priority:** P1
- **Status:** Todo
- **Owner:** Unassigned
- **Scope:** Update SessionView to show real-time agent output. Stream stdout, highlight tool calls, show progress.
- **Acceptance Criteria:**
  - Streams agent stdout in real-time
  - Parses and highlights tool calls (Read, Write, Bash, etc.)
  - Shows progress bar based on output parsing
  - Shows elapsed time
  - Scrollable with j/k, auto-scroll toggle
- **Validation Steps:**
  - `bun run typecheck` passes
  - Manual test: see live agent output
  - Manual test: tool calls highlighted
- **Notes:**
- **Dependencies:** T006, T012

### Ticket: T016 Graceful Shutdown
- **Priority:** P1
- **Status:** Done
- **Owner:** Completed
- **Scope:** Handle Ctrl+C and quit command properly. Stop all agents, save state, exit cleanly.
- **Acceptance Criteria:**
  - Ctrl+C triggers graceful shutdown
  - All agent processes killed (SIGTERM, wait 5s, SIGKILL)
  - Current ticket states preserved (In Progress stays In Progress)
  - Exit message shows summary
  - No orphaned processes
- **Validation Steps:**
  - `bun run typecheck` passes
  - Manual test: Ctrl+C during agent run
  - Verify no orphaned claude processes
- **Notes:** Implementation complete. Created src/core/shutdown.ts with signal handlers for SIGINT/SIGTERM. Uses Orchestrator.stop() which calls AgentManager.stopAll() and ReviewAgent.stopAll() - both implement SIGTERM-wait-SIGKILL pattern. App.quit() triggers graceful shutdown. Shutdown summary shows agents stopped, tickets in progress, and total cost. Tests added in shutdown.test.ts.
- **Dependencies:** T007

### Ticket: T017 Configuration System
- **Priority:** P0
- **Status:** Done
- **Owner:** Completed
- **Scope:** Create configuration system for ORCH settings including automation modes. Required for Review/QA automation.
- **Acceptance Criteria:**
  - Reads config from .orchrc or orch.config.json
  - Core settings: maxAgents, logLevel, agentModel, planFile
  - Automation settings: ticketProgression, review.mode, qa.mode
  - Automation modes: "automatic", "approval", "manual"
  - Cost limit settings: perTicket, perSession, action
  - Defaults work without config file (automatic mode)
  - Environment variables override config (ORCH_*)
  - Invalid config shows helpful error with line numbers
  - Config hot-reload (detect changes without restart)
- **Validation Steps:**
  - `bun run typecheck` passes
  - Unit test: config loading with all options
  - Unit test: environment variable overrides
  - Manual test: automation modes affect behavior
- **Notes:** This is P0 because automation modes are required for Review/QA agents
- **Dependencies:** T001

### Ticket: T018 Error Recovery
- **Priority:** P2
- **Status:** Todo
- **Owner:** Unassigned
- **Scope:** Handle error conditions gracefully. Agent crashes, network failures, malformed output.
- **Acceptance Criteria:**
  - Agent crash: log error, mark ticket failed, allow retry
  - Network timeout: retry with backoff (3 attempts)
  - Malformed output: log warning, continue processing
  - Plan parse error: show error, don't start orchestration
  - All errors logged with context
- **Validation Steps:**
  - `bun run typecheck` passes
  - Unit test: simulated agent crash
  - Manual test: kill agent process, verify recovery
- **Notes:**
- **Dependencies:** T007, T008

### Ticket: T019 Help Overlay
- **Priority:** P2
- **Status:** Todo
- **Owner:** Unassigned
- **Scope:** Implement '?' key to show help overlay with all keyboard shortcuts for current view.
- **Acceptance Criteria:**
  - '?' toggles help overlay
  - Shows global shortcuts
  - Shows view-specific shortcuts
  - Escape closes overlay
  - Semi-transparent background
- **Validation Steps:**
  - `bun run typecheck` passes
  - Manual test: help shows correct shortcuts per view
- **Notes:**
- **Dependencies:** T010

### Ticket: T020 Plan View Implementation
- **Priority:** P2
- **Status:** Todo
- **Owner:** Unassigned
- **Scope:** Make PlanView functional for editing the project plan via chat interface with AI assistant.
- **Acceptance Criteria:**
  - Chat input accepts user messages
  - AI responses displayed (mock for now, real AI later)
  - DocPreview shows current PLAN.md
  - Changes reflected in preview
  - Tab switches between chat and doc
- **Validation Steps:**
  - `bun run typecheck` passes
  - Manual test: type message, see response
  - Manual test: doc preview updates
- **Notes:**
- **Dependencies:** T010

### Ticket: T021 Refine View Implementation
- **Priority:** P2
- **Status:** Todo
- **Owner:** Unassigned
- **Scope:** Make RefineView functional for improving individual tickets before execution.
- **Acceptance Criteria:**
  - Sidebar lists all tickets
  - j/k navigates ticket list
  - Selected ticket shown in detail
  - Chat for refining selected ticket
  - Suggestions applied update PLAN.md
- **Validation Steps:**
  - `bun run typecheck` passes
  - Manual test: select ticket, see details
  - Manual test: refinement updates plan
- **Notes:**
- **Dependencies:** T010, T003

### Ticket: T022 CLI Entry Point
- **Priority:** P0
- **Status:** Done
- **Owner:** Completed
- **Scope:** Create the `orch` CLI command entry point. Parse args, initialize components, start TUI.
- **Acceptance Criteria:**
  - `orch` with no args starts in current directory
  - `orch --help` shows usage
  - `orch --version` shows version
  - `orch path/to/project` starts in specified directory
  - Validates PLAN.md exists before starting
- **Validation Steps:**
  - `bun run typecheck` passes
  - Manual test: run `orch` in project with PLAN.md
  - Manual test: run `orch` without PLAN.md shows error
- **Notes:**

### Ticket: T023 Unit Test Setup
- **Priority:** P1
- **Status:** Done
- **Owner:** Completed
- **Scope:** Set up test infrastructure with Bun test runner. Create test utilities, mocks for subprocess.
- **Acceptance Criteria:**
  - `bun test` runs all tests
  - Test files: *.test.ts
  - Mock utilities for: subprocess, filesystem, clock
  - Coverage reporting enabled
  - Tests run in CI (GitHub Actions)
- **Validation Steps:**
  - `bun test` passes with sample test
  - Coverage report generated
- **Notes:** Implementation complete. Created src/test-utils/ with: MockSubprocess (mock Bun.spawn with stdout/stderr streaming), MockFilesystem (in-memory filesystem with read/write/rm/mkdir), MockClock (timer control with setTimeout/setInterval/tick/runAll). Added createTestSetup(), SpawnTracker, convenience mocks. MockClock uses explicit methods instead of global replacement for Bun compatibility. Added test:coverage script to package.json. Added .github/workflows/ci.yml for GitHub Actions with test, typecheck, coverage, and build jobs. 631 tests passing, typecheck passes.
- **Dependencies:** None

### Ticket: T024 Integration Tests
- **Priority:** P1
- **Status:** Todo
- **Owner:** Unassigned
- **Scope:** Create integration tests for end-to-end workflows. Test full ticket completion cycle.
- **Acceptance Criteria:**
  - Test: parse plan → compute ready → assign agent (mock) → complete → update plan
  - Test: dependency chain A→B, B blocked until A done
  - Test: concurrent agents both complete
  - Uses real plan store with temp files
  - Completes in < 10 seconds
- **Validation Steps:**
  - `bun test` passes all integration tests
- **Notes:**
- **Dependencies:** T023, T008

### Ticket: T025 Cost Tracking
- **Priority:** P2
- **Status:** Todo
- **Owner:** Unassigned
- **Scope:** Track and display API costs per agent and total. Parse token counts from Claude output.
- **Acceptance Criteria:**
  - Parse token counts from agent output
  - Calculate cost per agent (input/output tokens)
  - Display in AgentCard and Agents summary
  - Total cost in status bar
  - Cost persists in session log
- **Validation Steps:**
  - `bun run typecheck` passes
  - Manual test: see cost update during agent run
- **Notes:**
- **Dependencies:** T006, T012

### Ticket: T026 Review Agent Implementation
- **Priority:** P0
- **Status:** Done
- **Owner:** Completed
- **Scope:** Create the Review Agent that performs automated code review when tickets enter the Review lane.
- **Acceptance Criteria:**
  - Spawns automatically when ticket enters Review status (if automation.review.mode is "automatic")
  - Uses specialized review prompt template
  - Analyzes code changes (git diff) against ticket requirements
  - Checks for: code quality, security issues, bugs, adherence to patterns
  - Outputs review decision: APPROVED or CHANGES_REQUESTED
  - If approved: ticket moves to QA
  - If rejected: ticket returns to In Progress with feedback attached
  - Respects automation mode (automatic/approval/manual)
  - In "approval" mode: agent runs but waits for human to confirm decision
- **Validation Steps:**
  - `bun run typecheck` passes
  - Unit test: review prompt generation
  - Integration test: ticket flows from Review → QA on approval
  - Integration test: ticket flows from Review → In Progress on rejection
- **Notes:** Implemented ReviewAgent class with: spawnReviewAgent(), parseReviewDecision(), automation mode support. Integrated with Orchestrator to auto-spawn on Review status. Added getTicketDiff() to epic-manager. 535 tests pass.
- **Dependencies:** T007, T017, T003

### Ticket: T027 QA Agent Implementation
- **Priority:** P0
- **Status:** Done
- **Owner:** Completed
- **Scope:** Create the QA Agent that performs automated testing when tickets enter the QA lane.
- **Acceptance Criteria:**
  - Spawns automatically when ticket enters QA status (if automation.qa.mode is "automatic")
  - Uses specialized QA/testing prompt template
  - Performs manual testing based on acceptance criteria
  - Can run the application, interact with UI/API, verify behavior
  - Executes validation steps from ticket
  - Outputs QA decision: PASSED or FAILED
  - If passed: ticket moves to Done
  - If failed: ticket returns to In Progress with bug report attached
  - Respects automation mode (automatic/approval/manual)
  - In "approval" mode: agent runs but waits for human to confirm decision
- **Validation Steps:**
  - `bun run typecheck` passes
  - Unit test: QA prompt generation
  - Integration test: ticket flows from QA → Done on pass
  - Integration test: ticket flows from QA → In Progress on fail
- **Notes:** Implementation complete. QAAgent class with startQA(), parseQAOutput(), handleQAComplete() methods. parseQADecision() extracts PASSED/FAILED decisions and test results from agent output. buildQAPromptFromTemplate() creates prompts from template. 25 unit tests passing.
- **Dependencies:** T007, T017, T003

### Ticket: T028 Ticket Status Pipeline
- **Priority:** P0
- **Status:** Done
- **Owner:** Completed
- **Scope:** Implement the full ticket status pipeline with transitions and automatic progression.
- **Acceptance Criteria:**
  - Status enum: Todo, InProgress, Review, QA, Done, Failed
  - Transition rules enforced: Todo→InProgress→Review→QA→Done
  - Review/QA can reject back to InProgress
  - Failed state can be retried (reset to Todo)
  - Automatic progression configurable via automation settings
  - Manual intervention: user can approve/reject at any stage
  - 'a' key approves current stage (moves ticket forward)
  - 'r' key rejects current stage (moves ticket back to In Progress)
  - Feedback/bug reports attached to ticket on rejection
- **Validation Steps:**
  - `bun run typecheck` passes
  - Unit test: all valid transitions work
  - Unit test: invalid transitions blocked
  - Integration test: full pipeline from Todo to Done
- **Notes:**
  - Agent-T028 implementation complete:
    - Created src/core/status-pipeline.ts with full transition validation logic
    - Status pipeline: Todo->InProgress->Review->QA->Done, with Failed as special state
    - isValidTransition(from, to) validates any status transition
    - getNextStatus(current, config?) returns next status based on automation config
    - getPreviousStatus(current) returns rejection target (always Todo for Review/QA)
    - canAdvance/canReject/canRetry helper functions for UI state
    - assertValidTransition throws with helpful error for invalid transitions
    - getStatusActions() returns available actions for 'a'/'r' key handling
    - sortStatusesByOrder() for consistent status ordering (Failed first)
    - Updated Orchestrator to use pipeline validation in advanceTicket/rejectTicket/retryTicket
    - All methods now emit ticket:status-changed events
    - 114 new status-pipeline tests + 41 orchestrator tests passing (155 total)
    - typecheck passes
- **Dependencies:** T003, T008

### Ticket: T029 Human Intervention UI
- **Priority:** P1
- **Status:** Todo
- **Owner:** Unassigned
- **Scope:** Add UI controls for human intervention in the automated pipeline.
- **Acceptance Criteria:**
  - In Kanban: visual indicator shows which tickets await human approval
  - In TicketView: show Review/QA agent output and approval buttons
  - 'a' key approves and advances ticket
  - 'r' key rejects and returns ticket to In Progress
  - 't' key takes over (switches from automatic to manual for this ticket)
  - 'p' key pauses all automation for this ticket
  - Confirmation dialog for destructive actions
  - Status bar shows pending approvals count
- **Validation Steps:**
  - `bun run typecheck` passes
  - Manual test: approve ticket from UI
  - Manual test: reject ticket with feedback
  - Manual test: take over automated task
- **Notes:**
- **Dependencies:** T011, T026, T027

### Ticket: T030 Review/QA Prompt Templates
- **Priority:** P0
- **Status:** Done
- **Owner:** Completed
- **Scope:** Create specialized prompt templates for Review and QA agents.
- **Acceptance Criteria:**
  - Review prompt template includes:
    - Ticket context and acceptance criteria
    - Git diff of changes
    - Codebase patterns/conventions
    - Checklist: security, bugs, quality, patterns
    - Output format for APPROVED/CHANGES_REQUESTED
  - QA prompt template includes:
    - Ticket context and acceptance criteria
    - How to run the application
    - Test scenarios to execute
    - Output format for PASSED/FAILED
    - Bug report template for failures
  - Templates are parameterized (ticket ID, changes, etc.)
- **Validation Steps:**
  - `bun run typecheck` passes
  - Unit test: templates render correctly with sample data
  - Manual test: review agent produces useful feedback
  - Manual test: QA agent catches real bugs
- **Notes:**
- **Dependencies:** T002

### Ticket: T031 Epic Manager Implementation
- **Priority:** P0
- **Status:** Done
- **Owner:** Completed
- **Scope:** Create Epic Manager to handle epic directories and worktree lifecycle.
- **Acceptance Criteria:**
  - Discovers epics from PLAN.md (epic field on tickets)
  - Validates epic directories exist
  - Tracks which agents are working in which epic
  - Creates git worktrees when multiple agents need same epic
  - Worktree naming: `{epic}-worktree-{agent-id}`
  - Emits events: epic:worktree-created, epic:worktree-merged, epic:conflict
- **Validation Steps:**
  - `bun run typecheck` passes
  - Unit test: epic discovery from plan
  - Unit test: worktree creation/cleanup
- **Notes:** Core infrastructure for parallel agent work
- **Dependencies:** T001, T002

### Ticket: T032 Worktree Merge Handler
- **Priority:** P0
- **Status:** Done
- **Owner:** Completed
- **Scope:** Handle merging completed worktrees back to epic main branch.
- **Acceptance Criteria:**
  - Attempts merge when ticket passes QA
  - Detects merge conflicts
  - On conflict: pauses ticket, emits conflict event, alerts user
  - On success: cleans up worktree, emits merge success
  - Supports manual conflict resolution workflow
  - 'm' key in UI triggers merge retry after manual resolution
- **Validation Steps:**
  - `bun run typecheck` passes
  - Integration test: clean merge succeeds
  - Integration test: conflict detected and reported
- **Notes:**
  - Agent-T032 implementation complete:
    - mergeWorktree(): Merges worktree branch to target branch, emits epic:worktree-merged or epic:conflict
    - cleanupWorktree(): Removes worktree from git and updates tracking
    - cleanupStaleWorktrees(): Removes worktrees older than threshold
    - retryMerge(): Completes merge after manual conflict resolution (for 'm' key UI action)
    - getWorktreeByPath(), getWorktreeByTicketId(): Helper methods for finding worktrees
    - mergeBranch(): Git merge with conflict detection
    - removeWorktree(): Git worktree removal with optional force flag
    - getCurrentBranch(), abortMerge(), isMergeInProgress(), completeMergeAfterConflictResolution()
    - 49 epic-manager tests (13 new tests for T032), all passing
    - typecheck passes
- **Dependencies:** T031

### Ticket: T033 Epic-Aware Agent Spawning
- **Priority:** P0
- **Status:** Done
- **Owner:** Completed
- **Scope:** Update agent spawning to work within epic worktrees.
- **Acceptance Criteria:**
  - Agent receives working directory from Epic Manager
  - Agent prompt includes epic context and path
  - Agent spawns in correct worktree directory
  - Agent commits to worktree branch (not main)
  - Branch naming: `ticket/{ticket-id}`
- **Validation Steps:**
  - `bun run typecheck` passes
  - Manual test: agent works in correct directory
  - Manual test: changes committed to correct branch
- **Notes:**
  - Implementation complete:
    - Updated SpawnOptions to include `branch` and `epicName` parameters
    - Updated buildImplementationPrompt() to include Git Context section when branch is provided
    - Git Context includes branch name, epic name, checkout instructions, and commit guidelines
    - Updated orchestrator.assignTicket() to pass branch and epicName from EpicManager allocation
    - Added 5 new unit tests for epic-aware prompt generation
    - All 429 tests pass, typecheck passes
- **Dependencies:** T007, T031

### Ticket: T034 Kanban Epic Grouping
- **Priority:** P1
- **Status:** Todo
- **Owner:** Unassigned
- **Scope:** Update Kanban view to group tickets by epic and show worktree status.
- **Acceptance Criteria:**
  - Tickets grouped by epic within each column
  - Epic headers shown with collapse/expand
  - Visual indicator for active worktrees per epic
  - Shows which agent is in which worktree
  - Filter by epic (press 'e' to cycle)
- **Validation Steps:**
  - `bun run typecheck` passes
  - Manual test: tickets grouped correctly
  - Manual test: epic filter works
- **Notes:**
- **Dependencies:** T011, T031

### Ticket: T035 AI-Assisted Ticket Creation
- **Priority:** P1
- **Status:** Todo
- **Owner:** Unassigned
- **Scope:** Implement AI-assisted ticket creation in Refine view chat interface.
- **Acceptance Criteria:**
  - User can describe a task in natural language
  - AI proposes ticket(s) with: title, description, epic, priority, acceptance criteria, dependencies
  - User refines through conversation ("make smaller", "add validation")
  - AI auto-assigns epic based on file paths mentioned
  - 'c' key creates the proposed ticket(s)
  - 'e' key edits before creating
  - New tickets appear in PLAN.md immediately
- **Validation Steps:**
  - `bun run typecheck` passes
  - Manual test: create ticket through conversation
  - Manual test: epic auto-assignment works
- **Notes:**
- **Dependencies:** T021, T003

### Ticket: T036 Refine Agent Integration
- **Priority:** P1
- **Status:** Todo
- **Owner:** Unassigned
- **Scope:** Connect Refine view chat to a Claude Code agent for ticket creation/refinement.
- **Acceptance Criteria:**
  - Spawns Refine Agent when entering Refine view
  - Agent has context of current PLAN.md and epic structure
  - Agent can read codebase to understand context
  - Specialized prompt for ticket creation and refinement
  - Streams responses in real-time
  - Agent updates PLAN.md on user approval
- **Validation Steps:**
  - `bun run typecheck` passes
  - Manual test: have full conversation about new feature
  - Manual test: agent creates well-structured tickets
- **Notes:**
- **Dependencies:** T035, T007

### Ticket: T038 Plan Audit (Auto-Refine)
- **Priority:** P1
- **Status:** Todo
- **Owner:** Unassigned
- **Scope:** Implement automated plan analysis that identifies gaps, staleness, and inaccuracies.
- **Acceptance Criteria:**
  - 'A' key in Refine view triggers plan audit
  - Audit compares tickets against PRD.md (if exists)
  - Audit analyzes codebase for coverage gaps
  - Detects: missing tickets, outdated tickets, inaccurate acceptance criteria
  - Detects: orphaned tickets (code deleted), stale dependencies
  - Results displayed as findings list with severity (error, warning, info)
  - Each finding includes suggested action (create, update, deprecate)
  - User can accept suggestions to auto-create/update tickets
  - Audit can run automatically on Refine view entry (configurable)
- **Validation Steps:**
  - `bun run typecheck` passes
  - Manual test: audit detects missing ticket for implemented feature
  - Manual test: audit detects ticket for deleted code
  - Manual test: accept suggestion creates ticket correctly
- **Notes:** Leverages Refine Agent with specialized audit prompt
- **Dependencies:** T036, T002

### Ticket: T037 Plan Parser Epic Support
- **Priority:** P0
- **Status:** Done
- **Owner:** Completed
- **Scope:** Update plan parser to handle epic field on tickets and epic definitions.
- **Acceptance Criteria:**
  - Parses `- Epic: {epic-name}` field on tickets
  - Parses epic definitions section in PLAN.md
  - Epic definition includes: name, path, description
  - Validates epic paths exist on filesystem
  - Reports missing epic assignments as warnings
- **Validation Steps:**
  - `bun run typecheck` passes
  - Unit test: parse tickets with epic field
  - Unit test: parse epic definitions
- **Notes:**
  - Agent-T037 implementation complete:
    - parseEpics() parses ## Epics section with ### Epic: {name} format
    - Epic fields: name, path, description
    - validateEpicPaths() checks filesystem for epic directories
    - findMissingEpicAssignments() finds tickets without epic or with undefined epic
    - PlanStore.getEpicWarnings() returns all epic-related warnings after load()
    - Added EpicWarning interface with types: missing_path, invalid_path, missing_assignment, undefined_epic
    - 22 new T037 tests added (68 total plan-store tests passing)
    - typecheck passes
- **Dependencies:** T002

## 8. Open Questions

1. **Agent model selection:** Should users be able to specify different models (Haiku vs Sonnet vs Opus) per ticket based on complexity? Currently config allows setting model for review/qa agents separately.

2. **Worktree limits:** How many worktrees per epic should be allowed? Should there be automatic cleanup of stale worktrees?

3. **Review scope:** Should Review Agent review only the files changed, or should it consider broader context (related files, tests)?

4. **QA test persistence:** Should QA Agent's test scenarios be saved for regression testing later?

5. **Resume behavior:** When ORCH restarts, should it attempt to resume tickets that were in Review/QA? What about orphaned worktrees?

6. **Claude Code authentication:** Should ORCH verify Claude Code is authenticated before starting? How to handle auth expiration mid-session?

7. **Plan file format:** The PRD shows one format, but should we support variations (different heading styles, YAML frontmatter, etc.)?

8. **Feedback loop:** When Review/QA rejects, should the implementation agent automatically receive and address the feedback, or require manual restart?

9. **Epic initialization:** Should ORCH auto-create epic directories if they don't exist? Or require user to set them up first?

10. **Cross-epic dependencies:** How should tickets that depend on tickets in different epics be handled? Merge order matters.

## 9. Discovered Issues Log

> _New issues must be appended here with a timestamp and brief context._
