# CLAUDE.md - Project Guide for AI Assistants

## Project Overview

ORCH is a terminal-based AI agent orchestrator that coordinates multiple Claude Code agents working on a software project simultaneously. It reads a project plan (PLAN.md), spawns agents to work on tickets, manages dependencies, and monitors progress in real-time.

**Tech Stack:** TypeScript, Bun runtime, OpenTUI (@opentui/core)

## Directory Structure

```
orch/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── app.ts                # TUI application (OpenTUI)
│   ├── core/                 # Core orchestration logic
│   │   ├── events.ts         # Event bus (pub/sub)
│   │   ├── types.ts          # All TypeScript types
│   │   ├── plan-store.ts     # PLAN.md parser/writer
│   │   ├── orchestrator.ts   # Main orchestration + DependencyGraph
│   │   ├── agent-manager.ts  # Agent lifecycle, output parsing, prompts
│   │   ├── epic-manager.ts   # Git worktree management
│   │   ├── config.ts         # Configuration loading
│   │   ├── validation-runner.ts # Run ticket validation commands
│   │   └── *.test.ts         # Unit tests (Bun test runner)
│   ├── components/           # OpenTUI UI components
│   ├── views/                # TUI view screens
│   ├── state/                # UI state management
│   └── utils/                # Utility functions
├── PLAN.md                   # Project plan with tickets
├── PRD.md                    # Product requirements document
└── mise.toml                 # Bun version config
```

## Key Modules

| Module | Purpose |
|--------|---------|
| `events.ts` | Central event bus - all components communicate via typed events |
| `plan-store.ts` | Reads/writes PLAN.md, parses tickets, emits plan events |
| `orchestrator.ts` | DependencyGraph class, computes ready tickets, manages workflow |
| `agent-manager.ts` | Spawns claude CLI, captures output, detects completion/blocked |
| `epic-manager.ts` | Manages git worktrees for parallel agent work on same epic |
| `config.ts` | Loads .orchrc or orch.config.json, env var overrides |
| `validation-runner.ts` | Executes ticket validation commands with timeout |
| `review-agent.ts` | Review agent for automated code review |
| `qa-agent.ts` | QA agent for automated testing |
| `status-pipeline.ts` | Status transition validation and pipeline logic |

## Commands

```bash
# Run the TUI
bun run src/index.ts

# Run tests (535 tests)
bun test

# Type check
bun run typecheck

# Run specific test file
bun test src/core/events.test.ts
```

## Architecture Patterns

1. **Event-Driven**: All components communicate via EventBus, not direct imports
2. **File-Based State**: PLAN.md is the source of truth, no database
3. **Atomic Writes**: Plan updates use temp file + rename
4. **Typed Events**: All events defined in types.ts (plan:*, agent:*, ticket:*, epic:*)

## Agent Communication

Agents signal completion/blockers via markers in their output:
```
=== TICKET T001 COMPLETE ===
=== TICKET T001 BLOCKED: [reason] ===
=== REVIEW DECISION: APPROVED ===
=== REVIEW DECISION: CHANGES_REQUESTED ===
=== QA DECISION: PASSED ===
=== QA DECISION: FAILED ===
```

## Current Implementation Status

**Done (27 tickets):** T001-T013, T015-T017, T022-T024, T026-T028, T030-T033, T037

**All P0 tickets complete.** Core orchestration infrastructure is fully implemented:
- Event bus, plan parsing, dependency graph
- Agent spawning, output parsing, validation
- Orchestrator core loop with auto-assignment
- Review and QA agents with automation modes
- Status pipeline with transition validation
- Epic/worktree management with merge handling
- State store with event subscriptions
- UI views connected to real state (Kanban, Agents, Logs, Session)
- Unit test infrastructure and integration tests

**Remaining P1:** T014 (TicketView Agent Actions), T029 (Human Intervention UI), T034 (Kanban Epic Grouping), T035 (AI-Assisted Tickets), T036 (Refine Agent), T038 (Plan Audit)

**Remaining P2:** T018-T021 (Error Recovery, Help Overlay, Plan/Refine Views), T025 (Cost Tracking)

## Testing

- Tests use Bun's test runner (`bun:test`)
- Test files are co-located: `module.ts` -> `module.test.ts`
- Run all: `bun test`
- Watch mode: `bun test --watch`

## Configuration

Config loaded from (in order): `.orchrc`, `orch.config.json`, `orch.config.ts`

Environment overrides: `ORCH_MAX_AGENTS`, `ORCH_LOG_LEVEL`, `ORCH_AGENT_MODEL`, etc.

Default automation mode is "automatic" (agents auto-progress through Review/QA).

---

## Instructions for Claude

### When Finishing Work

1. **Commit changes** after each completed ticket with descriptive message
2. **Update PLAN.md** - mark tickets as Done, add notes
3. **Update this file (CLAUDE.md)** if:
   - New modules are added
   - Architecture patterns change
   - Implementation status changes significantly
4. **Update README.md** if:
   - New user-facing features are added
   - Setup/usage instructions change
   - New commands are available

### Commit Message Format

```
<type>: <short description>

- Bullet points of changes
- Reference ticket IDs (T001, T002, etc.)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

### Before Starting Work

1. Read PLAN.md to understand current ticket status
2. Run `bun test` to ensure tests pass
3. Check git status for any uncommitted changes
