# ORCH - AI Agent Orchestrator

![Status](https://img.shields.io/badge/status-under%20construction-yellow)
![Version](https://img.shields.io/badge/version-0.1.0-blue)

> **Under Construction** - This project is in early development and not yet ready for use. APIs and features may change significantly.

A terminal-based orchestration tool that coordinates multiple autonomous Claude Code agents working on a software project simultaneously.

## What is ORCH?

ORCH reads a project plan (PLAN.md), spawns AI agents to work on tickets, manages dependencies, monitors progress in real-time, and maintains coherence across the codebase. Think of it as a construction foreman for AI-assisted development.

**Key capabilities:**
- Parallel agent execution (3-10 concurrent agents)
- Dependency-aware task scheduling
- Real-time progress monitoring via TUI
- Automated code review and QA
- Epic/worktree management for isolated parallel work
- AI-assisted ticket creation and plan auditing

## Prerequisites

- [Bun](https://bun.sh/) runtime
- [Claude Code CLI](https://claude.ai/code) installed and authenticated
- macOS, Linux, or Windows WSL

## Quick Start

```bash
# Install dependencies
bun install

# Run ORCH in your project directory
bun run start

# Or specify a project path
bun run start /path/to/project
```

## Project Structure

```
orch/
├── src/
│   ├── core/           # Orchestration logic
│   │   ├── events.ts       # Central event bus
│   │   ├── plan-store.ts   # PLAN.md parser and writer
│   │   ├── orchestrator.ts # Main orchestration engine
│   │   ├── agent-manager.ts# Agent lifecycle management
│   │   ├── epic-manager.ts # Epic/worktree management
│   │   ├── review-agent.ts # Automated code review
│   │   ├── qa-agent.ts     # Automated QA testing
│   │   └── types.ts        # Core type definitions
│   ├── ui/             # TUI layer (OpenTUI)
│   │   ├── components/     # Reusable UI components
│   │   └── views/          # Main view screens
│   └── index.ts        # Entry point
├── examples/           # Example files
│   ├── sample-plan.md      # Example PLAN.md
│   └── orch.config.json    # Example configuration
├── PLAN.md             # Implementation plan (38 tickets)
├── PRD.md              # Product requirements document
└── README.md           # This file
```

## TUI Views

| Key | View | Purpose |
|-----|------|---------|
| `1` | Plan | Create/refine project plan via AI chat |
| `2` | Refine | Create/improve tickets, run plan audits |
| `3` | Kanban | Visualize tickets across 5 columns |
| `4` | Agents | Monitor running agents |
| `5` | Logs | View activity history |

## Configuration

Create `.orchrc` or `orch.config.json` in your project root:

```json
{
  "maxAgents": 5,
  "agentModel": "sonnet",
  "automation": {
    "ticketProgression": "automatic",
    "review": { "mode": "automatic" },
    "qa": { "mode": "automatic" }
  }
}
```

See `examples/orch.config.json` for all options.

## PLAN.md Format

ORCH expects a `PLAN.md` file in your project root. See `examples/sample-plan.md` for the format, or use the Plan view to create one interactively.

## Development

```bash
# Type check
bun run typecheck

# Run tests
bun test

# Build
bun run build
```

## Documentation

- [PRD.md](./PRD.md) - Full product requirements
- [PLAN.md](./PLAN.md) - Implementation tickets

## License

MIT
