# ORCH: AI Agent Orchestrator

## Product Requirements Document

---

## 1. Executive Summary

ORCH is a terminal-based application that enables developers to coordinate multiple autonomous AI coding agents working on a software project simultaneously. It transforms a project plan into parallel workstreams, assigns agents to individual tasks, monitors their progress in real-time, and maintains coherence across the codebase.

**The core insight:** Modern AI coding assistants can work autonomously on well-defined tasks, but a single agent is limited to one task at a time. ORCH multiplies developer productivity by orchestrating many agents in parallel while providing visibility and control over the entire operation.

---

## 2. Problem Statement

### The Current State of AI-Assisted Development

Developers today use AI coding assistants (GitHub Copilot, Claude Code, Cursor, etc.) to accelerate their work. These tools are powerful but have fundamental limitations:

1. **Single-threaded interaction** - You can only have one conversation, working on one thing at a time
2. **Context switching overhead** - Moving between tasks requires re-establishing context
3. **No parallelization** - While an agent works on Task A, Tasks B, C, and D sit idle
4. **Manual coordination** - The developer must track what's done, what's pending, and what's blocked

### The Scaling Problem

When a project has 20 tasks to complete:
- **Without AI:** Developer does all 20 sequentially (or delegates to team)
- **With single AI agent:** Developer + AI do all 20 sequentially (faster, but still serial)
- **With orchestrated agents:** Multiple agents work in parallel; developer supervises

The bottleneck shifts from "doing the work" to "coordinating the work."

### Why This Matters

Software projects are increasingly automatable. An AI agent can:
- Read and understand code
- Write new code following patterns
- Run tests and fix failures
- Create documentation
- Refactor existing code

What AI agents cannot do well (yet):
- Coordinate with other agents
- Understand project-wide priorities
- Resolve conflicting changes
- Know when to ask for human input

**ORCH fills this gap** by providing the coordination layer that makes multi-agent development practical.

---

## 3. Product Vision

### What ORCH Is

ORCH is a **command-line orchestration tool** that:

1. **Reads a project plan** (PLAN.md) defining tickets with acceptance criteria
2. **Spawns autonomous AI agents** (Claude Code instances) to work on tickets
3. **Manages dependencies** - ensuring blocked tickets wait for their prerequisites
4. **Monitors progress** - showing real-time status of all agents and tickets
5. **Logs everything** - maintaining a complete record of agent actions
6. **Enables intervention** - letting the developer pause, redirect, or assist agents

### What ORCH Is Not

- **Not an IDE** - It orchestrates agents; it doesn't replace your editor
- **Not a project management tool** - It executes plans; it doesn't replace Jira/Linear
- **Not fully autonomous** - It requires human supervision and decision-making (though automation level is configurable)

### The Mental Model

Think of ORCH like a **construction site foreman**:
- The foreman doesn't lay bricks (that's what workers do)
- The foreman reads the blueprints (PLAN.md)
- The foreman assigns workers to tasks (agent spawning)
- The foreman ensures work happens in the right order (dependency management)
- The foreman monitors progress and handles problems (the TUI dashboard)

The developer is the **architect** - they design what gets built and review the results. ORCH is the foreman that makes it happen efficiently.

---

## 4. Target Users

### Primary Persona: The Power Developer

**Profile:**
- Professional software engineer (3+ years experience)
- Already uses AI coding assistants regularly
- Comfortable with terminal-based tools
- Works on projects with clear modularity
- Values automation and efficiency

**Pain Points:**
- "I know AI can write this code, but I can only use one agent at a time"
- "I spend more time coordinating tasks than writing code"
- "I lose track of what's been done when context-switching"
- "My AI assistant forgets context between sessions"

**Goals:**
- Maximize productive output per hour
- Maintain code quality while moving fast
- Stay in flow state (minimize context switches)
- Build confidence in AI-assisted development

### Secondary Persona: The Tech Lead

**Profile:**
- Manages a small team or project
- Responsible for delivery timelines
- Needs visibility into progress
- Makes prioritization decisions

**Pain Points:**
- "I can't see what's actually getting done"
- "Blockers aren't surfaced until it's too late"
- "I want to parallelize work but coordination overhead is high"

**Goals:**
- Clear visibility into project status
- Early warning of blocked work
- Ability to reprioritize on the fly
- Confidence that nothing falls through cracks

---

## 5. Core Concepts

### 5.1 The Plan (PLAN.md)

The **Plan** is a markdown file that serves as the single source of truth for project work. It contains:

- **Project Overview** - What we're building and why
- **Definition of Done** - How we know the project is complete
- **Task Backlog** - Individual tickets with:
  - Unique ID (T001, T002, etc.)
  - Title and description
  - Epic assignment (which epic/directory this ticket belongs to)
  - Priority (P0 = critical, P1 = high, P2 = normal)
  - Status (Todo, In Progress, Review, QA, Done, Failed)
  - Acceptance Criteria (specific, testable conditions)
  - Dependencies (which tickets must complete first)
  - Validation Steps (commands to verify completion)

**Why a markdown file?**
- Human-readable and editable
- Version-controlled with the code
- No external dependencies
- AI agents can read and update it

### 5.2 Epics and Worktrees

An **Epic** is a logical grouping of related tickets that share a common codebase context. Each epic corresponds to a **directory, repository, or git worktree**.

**Why Epics?**
- Large projects often have multiple codebases (frontend, backend, shared libs)
- Agents need isolated working directories to avoid conflicts
- Parallel work on the same codebase requires separate worktrees

**Epic Structure:**
```
my-project/
├── PLAN.md                    # Master plan with all tickets
├── epics/
│   ├── frontend/              # Epic: Frontend (React app)
│   │   ├── src/
│   │   └── package.json
│   ├── backend/               # Epic: Backend (API server)
│   │   ├── src/
│   │   └── package.json
│   └── shared/                # Epic: Shared libraries
│       └── src/
```

**Worktree Management:**
When multiple agents need to work on the same epic simultaneously, ORCH creates **git worktrees** to isolate their changes:

```
epics/
├── frontend/                  # Main worktree
├── frontend-worktree-1/       # Agent 1's isolated copy
└── frontend-worktree-2/       # Agent 2's isolated copy
```

This enables:
- **Safe parallelization** - Agents don't step on each other's changes
- **Clean merging** - Each worktree can be merged independently
- **Conflict isolation** - Conflicts are detected early, per-worktree

**Epic Assignment:**
- Each ticket belongs to exactly one epic
- When an agent is assigned a ticket, it works in that epic's directory
- The orchestrator manages worktree creation/cleanup automatically

### 5.3 Tickets

A **Ticket** is a unit of work that an agent can complete independently. Each ticket belongs to an epic and is worked on within that epic's directory. Good tickets are:

- **Atomic** - Can be completed without partial states
- **Testable** - Have clear acceptance criteria that can be verified
- **Scoped** - Small enough to complete in 5-30 minutes
- **Independent** - Minimal dependencies on other in-progress work

Examples of good tickets:
- "Add input validation to the signup form"
- "Create unit tests for the authentication module"
- "Implement the /api/users endpoint"

Examples of poor tickets:
- "Improve the codebase" (too vague)
- "Build the entire frontend" (too large)
- "Fix bugs" (not specific)

### 5.4 Agents

An **Agent** is an instance of an AI coding assistant (specifically Claude Code) that:

- Works on exactly one ticket at a time
- Operates within the ticket's epic directory (or assigned worktree)
- Has full access to that epic's codebase
- Can read files, write files, run commands
- Reports progress through its actions
- Completes or reports blockers

**Agent Isolation:**
- Each agent works in its own worktree when multiple agents target the same epic
- Changes are committed to a branch in the worktree
- The orchestrator merges completed work back to the epic's main branch

Agents are **autonomous but bounded**:
- They make decisions about how to implement
- They cannot change ticket priorities or assignments
- They cannot start work on unassigned tickets
- They report completion; the orchestrator verifies

### 5.5 Specialized Agents

Beyond implementation agents, ORCH uses **specialized agents** for quality gates:

**Review Agent**
- Automatically spawned when a ticket moves to Review status
- Analyzes code changes made by the implementation agent
- Checks for: code quality, adherence to patterns, potential bugs, security issues
- Can approve (move to QA) or request changes (move back to In Progress with feedback)
- Uses a focused prompt optimized for code review

**QA Agent**
- Automatically spawned when a ticket moves to QA status
- Performs manual testing based on acceptance criteria
- Runs the application, interacts with UI/API, verifies behavior
- Can approve (move to Done) or reject (move back to In Progress with bug report)
- Uses a focused prompt optimized for exploratory testing

**Automation Behavior**
By default, Review and QA agents run automatically when tickets reach their lanes. However, users can configure:
- **Automatic** (default): Agents spawn immediately, ticket progresses automatically on approval
- **Manual approval**: Agent runs, but human must approve before ticket moves
- **Human only**: No agent spawns; human performs review/QA manually

This is configured per-project or globally via settings.

### 5.6 The Orchestrator

The **Orchestrator** is the brain of ORCH. It:

1. **Reads the plan** and understands the ticket graph
2. **Manages epics and worktrees** - creates isolated worktrees for parallel work
3. **Identifies ready tickets** (no unmet dependencies)
4. **Spawns agents** for ready tickets in their epic's directory
5. **Monitors agent progress** through file system and process observation
6. **Verifies completion** by running validation steps
7. **Merges completed work** from worktrees back to epic main branch
8. **Updates the plan** as tickets complete
9. **Handles failures** by logging and alerting

The orchestrator runs continuously, reacting to events:
- Agent completes → verify → merge worktree → mark done → check for newly unblocked tickets
- Agent fails → log error → alert user → await intervention
- User changes priority → recalculate next tickets
- Merge conflict detected → pause ticket → alert user

### 5.7 Dependencies

Tickets can have **dependencies** - other tickets that must complete first.

Example:
```
T001: Create database schema
T002: Implement user model (depends on T001)
T003: Add user API endpoints (depends on T002)
T004: Write API documentation (depends on T003)
```

The orchestrator ensures:
- T001 starts immediately (no dependencies)
- T002 waits until T001 is verified done
- T003 waits until T002 is verified done
- T004 waits until T003 is verified done

Dependencies enable **safe parallelization**:
- T001 and an unrelated T005 can run simultaneously
- T002 and T003 cannot (T003 depends on T002's output)

---

## 6. User Experience

### 6.1 The Terminal Interface

ORCH runs in the terminal because:
- Developers already live in terminals
- No context switch to a browser
- Works over SSH on remote machines
- Keyboard-driven for speed
- Integrates with existing workflows

### 6.2 The Five Views

ORCH provides five main views, accessible via number keys:

#### View 1: Plan
**Purpose:** Create and refine the project plan through AI-assisted conversation

**Layout:**
- Left panel: Chat interface for discussing the project
- Right panel: Document preview (PRD, PLAN, tickets)

**Workflow:**
1. User describes what they want to build
2. AI suggests structure, breaks down into tickets
3. User refines through conversation
4. AI updates the plan document in real-time

#### View 2: Refine
**Purpose:** Create and improve tickets through AI-assisted conversation

**Layout:**
- Left sidebar: List of tickets (grouped by epic)
- Right panel: Large chat interface for ticket creation and refinement

**Capabilities:**
The Refine Agent can operate across a spectrum from fully autonomous to highly collaborative:

- **Autonomous generation:** User says "Generate all tickets from PRD.md" → Agent reads document, creates complete ticket set → User reviews and approves
- **Bulk creation:** User describes a feature → Agent proposes multiple related tickets → User accepts/modifies/rejects
- **Collaborative refinement:** User and agent iterate on ticket details through conversation
- **Targeted improvement:** User selects existing ticket → Agent suggests improvements

**Workflow:**
1. User enters Refine view and either:
   - Asks agent to generate tickets from a source (PRD, spec, conversation)
   - Selects an existing ticket to refine
   - Describes a new feature/task to create tickets for
2. Agent analyzes context (codebase, existing tickets, epic structure)
3. Agent proposes ticket(s) with: title, description, epic, priority, acceptance criteria, dependencies
4. User reviews proposals and can:
   - Accept all → tickets created in PLAN.md
   - Accept some, reject others
   - Request modifications ("split this", "add more detail", "different epic")
   - Ask for more tickets to be generated
5. Agent updates PLAN.md on user approval

**Key Point:** The user controls the level of involvement. A single command can generate an entire project's tickets, or the user can craft each ticket through detailed conversation.

**Plan Audit (Auto-Refine):**
The Refine Agent can also perform automated analysis of the current plan:
- **PRD Coverage:** Compare tickets against PRD requirements - identify missing coverage
- **Codebase Sync:** Analyze codebase for implemented features without tickets, or tickets for non-existent code
- **Accuracy Check:** Verify acceptance criteria match current implementation state
- **Staleness Detection:** Flag tickets with outdated dependencies or scope
- **Gap Analysis:** Identify obvious missing tickets (e.g., missing tests, missing docs)

Audit can be triggered manually ("Audit the plan") or run automatically when entering Refine view. Results appear as a list of findings with suggested actions (create, update, or deprecate tickets).

#### View 3: Kanban (Default)
**Purpose:** Visualize ticket status and control execution

**Layout:**
- Five columns: Backlog | In Progress | Review | QA | Done
- Each column shows ticket cards with key info
- Selected ticket is highlighted
- Review and QA columns show agent activity when automated

**Workflow:**
1. User navigates with keyboard (h/j/k/l)
2. Press Enter to view ticket details
3. Assign agents to tickets (or let them auto-assign)
4. Watch tickets move through columns as agents work
5. Review/QA agents automatically process tickets (configurable)
6. Intervene manually when needed (pause automation, take over)

#### View 4: Agents
**Purpose:** Monitor all running agents

**Layout:**
- Summary bar: Active/Idle counts, total cost
- List of agent cards showing:
  - Agent ID and model
  - Current ticket assignment
  - Progress bar
  - Token usage and cost
  - Last action taken

**Workflow:**
1. See all agents at a glance
2. Identify stuck or slow agents
3. Stop/restart agents as needed
4. View detailed session for any agent

#### View 5: Logs
**Purpose:** See everything that's happening

**Layout:**
- Filter bar: Level, Agent, Ticket, Search
- Scrollable log entries with:
  - Timestamp
  - Level (INFO, WARN, ERROR, EVENT)
  - Agent ID (if applicable)
  - Ticket number (if applicable)
  - Message

**Workflow:**
1. Watch real-time activity stream
2. Filter to specific agents or tickets
3. Search for specific actions
4. Debug issues when they arise

### 6.3 Keyboard-First Design

Every action is accessible via keyboard:

| Key | Action |
|-----|--------|
| `1-5` | Switch between views |
| `j/k` | Navigate up/down |
| `h/l` | Navigate left/right |
| `Enter` | Open/select |
| `Esc` | Go back/close |
| `Tab` | Switch panes |
| `q` | Quit |
| `?` | Help |

Mouse support exists but is secondary.

---

## 7. Technical Architecture

### 7.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        ORCH Process                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   TUI Layer  │  │ Orchestrator │  │  Plan Store  │          │
│  │  (OpenTUI)   │◄─┤    Engine    ├─►│  (PLAN.md)   │          │
│  └──────────────┘  └──────┬───────┘  └──────────────┘          │
│                           │                                     │
│         ┌─────────────────┼─────────────────┐                  │
│         ▼                 ▼                 ▼                  │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐          │
│  │   Agent 1   │   │   Agent 2   │   │   Agent N   │          │
│  │(subprocess) │   │(subprocess) │   │(subprocess) │          │
│  └──────┬──────┘   └──────┬──────┘   └──────┬──────┘          │
│         │                 │                 │                  │
└─────────┼─────────────────┼─────────────────┼──────────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
    ┌─────────────────────────────────────────────────┐
    │              Project Codebase                    │
    │         (files, tests, config, etc.)            │
    └─────────────────────────────────────────────────┘
```

### 7.2 Component Responsibilities

**TUI Layer (src/ui/)**
- Renders the interface using OpenTUI
- Handles keyboard/mouse input
- Subscribes to state changes and re-renders
- No business logic - pure presentation

**Orchestrator Engine (src/core/orchestrator.ts)**
- Reads and parses PLAN.md
- Maintains the dependency graph
- Decides which tickets are ready
- Spawns and monitors agent processes
- Verifies ticket completion
- Updates plan state

**Agent Manager (src/core/agent.ts)**
- Wrapper around Claude Code subprocess
- Captures agent output for logging
- Detects completion/failure signals
- Provides progress estimation
- Handles graceful shutdown

**Plan Store (src/core/plan-store.ts)**
- Reads PLAN.md from filesystem
- Parses markdown into structured data
- Writes updates back to PLAN.md
- Emits events on state changes
- Maintains consistency

**Event Bus (src/core/events.ts)**
- Central pub/sub system
- Decouples components
- Enables reactive UI updates
- Logs all events for debugging

### 7.3 Ticket Lifecycle

```
        ┌──────────────────────────────────────────────────────────┐
        │                    Ticket Lifecycle                       │
        └──────────────────────────────────────────────────────────┘

    ┌─────────┐     assign      ┌─────────────┐
    │ BACKLOG │────────────────►│ IN PROGRESS │
    │ (Todo)  │                 │  (Working)  │
    └─────────┘                 └──────┬──────┘
                                       │ implementation complete
                                       ▼
                                ┌─────────────┐
                       ┌────────│   REVIEW    │────────┐
                       │        │ (Review Agent)       │
                       │        └─────────────┘        │
                 rejected                         approved
                 (feedback)                            │
                       │                               ▼
                       │                        ┌─────────────┐
                       │               ┌────────│     QA      │────────┐
                       │               │        │ (QA Agent)  │        │
                       │               │        └─────────────┘        │
                       │         rejected                         approved
                       │         (bug report)                          │
                       │               │                               ▼
                       ▼               ▼                        ┌─────────────┐
                ┌─────────────────────────────┐                │    DONE     │
                │       IN PROGRESS           │                └─────────────┘
                │   (with feedback/bugs)      │
                └─────────────────────────────┘

    At any point, tickets can be marked FAILED if unrecoverable.
    Human can intervene at Review or QA stages if automation mode allows.
```

### 7.4 Agent Lifecycle

```
        ┌──────────────────────────────────────────────────────────┐
        │                    Agent Lifecycle                        │
        └──────────────────────────────────────────────────────────┘

                              ┌─────────┐
                              │  IDLE   │
                              └────┬────┘
                                   │ assign(ticket)
                                   ▼
                            ┌─────────────┐
                            │  STARTING   │
                            └──────┬──────┘
                                   │ process spawned
                                   ▼
                            ┌─────────────┐
              timeout ┌─────│   WORKING   │─────┐ completion signal
                      │     └─────────────┘     │
                      ▼                         ▼
               ┌─────────────┐           ┌─────────────┐
               │   BLOCKED   │           │ VALIDATING  │
               └──────┬──────┘           └──────┬──────┘
                      │                         │
          user        │                         │ validation
          intervention│              ┌──────────┴──────────┐
                      │              │                     │
                      ▼              ▼                     ▼
               ┌─────────────┐ ┌─────────────┐     ┌─────────────┐
               │   FAILED    │ │  COMPLETE   │     │   FAILED    │
               └─────────────┘ └─────────────┘     └─────────────┘
```

### 7.5 Data Flow

1. **User creates/modifies PLAN.md** (directly or via Plan view)
2. **Plan Store parses PLAN.md** and emits `plan:updated` event
3. **Orchestrator receives event** and recalculates ready tickets
4. **Orchestrator spawns agents** for ready tickets
5. **Agents work on codebase** (read/write files, run commands)
6. **Agent Manager captures output** and emits `agent:progress` events
7. **TUI subscribes to events** and updates display
8. **Agent signals completion** (specific output format)
9. **Orchestrator runs validation** steps from ticket
10. **If valid, Plan Store updates PLAN.md** (status → Review)
11. **Review Agent spawns** (if automation enabled) → analyzes changes → approves/rejects
12. **If approved, ticket moves to QA** → QA Agent spawns → tests functionality
13. **If QA passes, ticket moves to Done**
14. **Cycle repeats** for newly unblocked tickets

### 7.6 Configuration System

ORCH supports a configuration file (`.orchrc` or `orch.config.json`) for customizing behavior:

```json
{
  "maxAgents": 5,
  "agentModel": "sonnet",
  "planFile": "PLAN.md",
  "automation": {
    "ticketProgression": "automatic",
    "review": {
      "mode": "automatic",
      "model": "sonnet"
    },
    "qa": {
      "mode": "automatic",
      "model": "sonnet"
    }
  },
  "costLimit": {
    "perTicket": 5.00,
    "perSession": 50.00,
    "action": "pause"
  }
}
```

**Automation Modes:**
- `automatic` - Agents spawn and progress tickets without human intervention
- `approval` - Agents run but require human approval to progress
- `manual` - No agents spawn; human performs the action

**Cost Limits:**
- `perTicket` - Maximum spend per ticket before pausing
- `perSession` - Maximum spend per ORCH session
- `action` - What to do when limit reached: `pause`, `warn`, or `stop`

Settings can also be overridden via environment variables (e.g., `ORCH_MAX_AGENTS=3`).

---

## 8. Functional Requirements

### 8.1 Plan Management

| ID | Requirement | Priority |
|----|-------------|----------|
| PM-1 | System shall read PLAN.md from the project root | P0 |
| PM-2 | System shall parse tickets with ID, title, status, priority, dependencies, acceptance criteria, validation steps | P0 |
| PM-3 | System shall write updates to PLAN.md when ticket status changes | P0 |
| PM-4 | System shall validate PLAN.md syntax and report errors | P1 |
| PM-5 | System shall detect circular dependencies and report errors | P1 |
| PM-6 | System shall support creating new tickets via Plan view | P2 |

### 8.2 Agent Management

| ID | Requirement | Priority |
|----|-------------|----------|
| AM-1 | System shall spawn Claude Code as a subprocess for each agent | P0 |
| AM-2 | System shall pass ticket context to agent via prompt | P0 |
| AM-3 | System shall capture agent stdout/stderr for logging | P0 |
| AM-4 | System shall detect agent completion via output parsing | P0 |
| AM-5 | System shall track agent resource usage (tokens, cost) | P1 |
| AM-6 | System shall support stopping an agent gracefully | P1 |
| AM-7 | System shall support restarting a failed agent | P1 |
| AM-8 | System shall limit concurrent agents (configurable) | P1 |

### 8.3 Orchestration

| ID | Requirement | Priority |
|----|-------------|----------|
| OR-1 | System shall identify tickets ready for work (no unmet dependencies) | P0 |
| OR-2 | System shall assign agents to ready tickets by priority | P0 |
| OR-3 | System shall run validation steps when agent reports completion | P0 |
| OR-4 | System shall move tickets through pipeline: Todo → In Progress → Review → QA → Done | P0 |
| OR-5 | System shall mark tickets Failed if validation fails | P0 |
| OR-6 | System shall recalculate ready tickets when any ticket completes | P0 |
| OR-7 | System shall respect ticket priorities when assigning agents | P1 |
| OR-8 | System shall detect and report deadlocks | P2 |
| OR-9 | System shall support automatic ticket progression (configurable) | P0 |

### 8.4 Code Review

| ID | Requirement | Priority |
|----|-------------|----------|
| CR-1 | System shall spawn Review Agent when ticket enters Review status | P0 |
| CR-2 | Review Agent shall analyze code changes against best practices | P0 |
| CR-3 | Review Agent shall check for security issues, bugs, code smells | P1 |
| CR-4 | Review Agent shall approve (advance to QA) or reject (return to In Progress) | P0 |
| CR-5 | System shall support manual review mode (human reviews instead of agent) | P1 |
| CR-6 | System shall support approval mode (agent reviews, human approves) | P1 |
| CR-7 | Review feedback shall be attached to ticket for implementation agent | P1 |

### 8.5 Quality Assurance

| ID | Requirement | Priority |
|----|-------------|----------|
| QA-1 | System shall spawn QA Agent when ticket enters QA status | P0 |
| QA-2 | QA Agent shall perform manual testing based on acceptance criteria | P0 |
| QA-3 | QA Agent shall run application and verify expected behavior | P0 |
| QA-4 | QA Agent shall approve (advance to Done) or reject (return to In Progress) | P0 |
| QA-5 | System shall support manual QA mode (human tests instead of agent) | P1 |
| QA-6 | System shall support approval mode (agent tests, human approves) | P1 |
| QA-7 | QA results and bug reports shall be attached to ticket | P1 |

### 8.6 Configuration

| ID | Requirement | Priority |
|----|-------------|----------|
| CF-1 | System shall read configuration from .orchrc or orch.config.json | P1 |
| CF-2 | System shall support configuring max concurrent agents | P1 |
| CF-3 | System shall support configuring automation mode per stage | P0 |
| CF-4 | System shall support cost limits (per ticket, per session) | P2 |
| CF-5 | System shall support environment variable overrides | P1 |
| CF-6 | System shall work with sensible defaults when no config exists | P0 |
| CF-7 | System shall validate configuration and report errors | P1 |

### 8.7 User Interface

| ID | Requirement | Priority |
|----|-------------|----------|
| UI-1 | System shall provide Plan view for project planning | P1 |
| UI-2 | System shall provide Refine view for ticket improvement | P2 |
| UI-3 | System shall provide Kanban view with 5 columns (Backlog, In Progress, Review, QA, Done) | P0 |
| UI-4 | System shall provide Agents view for agent monitoring | P0 |
| UI-5 | System shall provide Logs view for activity history | P0 |
| UI-6 | System shall update views in real-time as events occur | P0 |
| UI-7 | System shall support keyboard navigation for all actions | P0 |
| UI-8 | System shall display help for available commands | P1 |
| UI-9 | System shall show Review/QA agent activity in respective columns | P1 |
| UI-10 | System shall allow manual intervention in automated processes | P1 |

### 8.8 Persistence and Recovery

| ID | Requirement | Priority |
|----|-------------|----------|
| PR-1 | System shall persist all state in PLAN.md (survives restart) | P0 |
| PR-2 | System shall recover gracefully from crash (no corrupt state) | P1 |
| PR-3 | System shall log all events to file for debugging | P1 |
| PR-4 | System shall allow resuming in-progress tickets after restart | P2 |

---

## 9. Non-Functional Requirements

### 9.1 Performance

- **Startup time:** < 2 seconds to interactive
- **UI responsiveness:** < 100ms for any user action
- **Agent spawn time:** < 5 seconds to first agent action
- **Memory usage:** < 200MB for ORCH process (excluding agents)
- **Concurrent agents:** Support at least 10 simultaneous agents

### 9.2 Reliability

- **No data loss:** PLAN.md updates are atomic
- **Graceful degradation:** Agent failure doesn't crash ORCH
- **Clear error messages:** All errors include actionable guidance
- **Logging:** Sufficient detail to diagnose any issue

### 9.3 Usability

- **Zero configuration:** Works out of the box with sensible defaults
- **Discoverable:** Help available for all commands
- **Consistent:** Same patterns across all views
- **Accessible:** Works in any terminal (no GUI dependencies)

### 9.4 Security

- **No credential storage:** Uses existing Claude Code auth
- **File access:** Operates only within project directory
- **Network:** Only outbound to Anthropic API (via Claude Code)
- **Secrets:** Never logs or displays API keys

---

## 10. Success Metrics

### 10.1 User Outcomes

| Metric | Target | Measurement |
|--------|--------|-------------|
| Tasks completed per hour | 3x single-agent baseline | User tracking |
| Time to complete project | 50% reduction | Before/after comparison |
| Context switches | 70% reduction | User survey |
| Developer satisfaction | > 8/10 | User survey |

### 10.2 Product Health

| Metric | Target | Measurement |
|--------|--------|-------------|
| Agent success rate | > 90% | Logs analysis |
| Validation pass rate | > 95% | Logs analysis |
| Crash rate | < 1 per 100 hours | Error tracking |
| Startup success | > 99% | Telemetry |

---

## 11. Open Questions

1. **Agent model selection:** Should users choose models (Haiku vs Sonnet vs Opus) per ticket based on complexity?

2. **Conflict resolution:** How do we handle merge conflicts when multiple agents modify nearby code?

3. **Cost controls:** Should ORCH enforce spending limits? Alert thresholds?

4. **Remote agents:** Should agents be able to run on remote machines for more parallelism?

5. **Team collaboration:** Should multiple users be able to view/control the same ORCH instance?

---

## 12. Out of Scope (v1)

The following are explicitly not included in version 1:

- **Web interface** - Terminal only
- **IDE integration** - Standalone tool
- **Custom agent types** - Claude Code only
- **Historical analytics** - Real-time only
- **CI/CD integration** - Manual deployment assumed
- **Remote worktrees** - Worktrees are local only

---

## 13. Glossary

| Term | Definition |
|------|------------|
| **Agent** | An instance of Claude Code working on a ticket |
| **Implementation Agent** | An agent that writes code to fulfill ticket requirements |
| **Review Agent** | A specialized agent that reviews code changes for quality |
| **QA Agent** | A specialized agent that performs manual testing |
| **Epic** | A logical grouping of tickets sharing a common codebase/directory |
| **Worktree** | An isolated git working directory for parallel agent work |
| **Ticket** | A unit of work with acceptance criteria, belonging to an epic |
| **Plan** | The PLAN.md file containing all tickets |
| **Orchestrator** | The component that manages agents, epics, worktrees, and ticket state |
| **Validation** | Running commands to verify a ticket is complete |
| **Dependency** | A relationship where one ticket requires another to complete first |
| **Ready** | A ticket with no unmet dependencies (can be assigned) |
| **Blocked** | A ticket waiting for dependencies to complete |
| **Automation Mode** | Configuration for how automated agents behave (automatic, approval, manual) |

---

## 14. Appendix

### A. Example PLAN.md Structure

```markdown
# Project Plan: Example Application

## Overview
Building a REST API for user management.

## Definition of Done
- All endpoints implemented and tested
- Documentation complete
- CI pipeline passing

## Task Backlog

### T001: Setup project structure
- Priority: P0
- Status: Done
- Acceptance Criteria:
  - package.json created with dependencies
  - TypeScript configured
  - ESLint configured
- Validation Steps:
  - npm install completes without errors
  - npm run typecheck passes

### T002: Implement user model
- Priority: P0
- Status: In Progress
- Dependencies: T001
- Acceptance Criteria:
  - User type defined with id, email, name
  - Validation functions for user fields
- Validation Steps:
  - npm run test -- user.test.ts passes

### T003: Create user endpoints
- Priority: P0
- Status: Todo
- Dependencies: T002
- Acceptance Criteria:
  - POST /users creates user
  - GET /users/:id returns user
  - PUT /users/:id updates user
  - DELETE /users/:id removes user
- Validation Steps:
  - npm run test -- api.test.ts passes
```

### B. Agent Prompt Template

```
You are working on ticket {{TICKET_ID}}: {{TITLE}}

## Context
Project: {{PROJECT_NAME}}
Codebase: {{REPO_PATH}}

## Your Task
{{DESCRIPTION}}

## Acceptance Criteria
{{ACCEPTANCE_CRITERIA}}

## Constraints
- Only modify files relevant to this ticket
- Run tests before reporting completion
- Report blockers immediately if you cannot proceed

## When Complete
Output exactly:
=== TICKET {{TICKET_ID}} COMPLETE ===
[Summary of changes]
```

---

*Document Version: 1.0*
*Last Updated: 2026-01-10*
