import { join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { App } from './app.js'
import { loadConfig } from './core/config.js'
import { registerShutdownHandlers } from './core/shutdown.js'

// Version from package.json
const VERSION = '0.1.0'

const HELP_TEXT = `
orch - AI Agent Orchestrator TUI

Usage:
  orch [options] [project-path]

Arguments:
  project-path    Path to project directory (default: current directory)

Options:
  -h, --help      Show this help message
  -v, --version   Show version number

Examples:
  orch                    Start in current directory
  orch ./my-project       Start in ./my-project directory
  orch /path/to/project   Start in absolute path

The project directory must contain a PLAN.md file.
`.trim()

interface ParsedArgs {
  help: boolean
  version: boolean
  projectPath: string
}

function parseArgs(argv: string[]): ParsedArgs {
  // argv[0] is bun, argv[1] is the script path
  const args = argv.slice(2)

  const result: ParsedArgs = {
    help: false,
    version: false,
    projectPath: process.cwd(),
  }

  for (const arg of args) {
    if (arg === '-h' || arg === '--help') {
      result.help = true
    } else if (arg === '-v' || arg === '--version') {
      result.version = true
    } else if (!arg.startsWith('-')) {
      // Positional argument - treat as project path
      result.projectPath = resolve(arg)
    } else {
      console.error(`Unknown option: ${arg}`)
      console.error('Use --help for usage information.')
      process.exit(1)
    }
  }

  return result
}

async function main() {
  const args = parseArgs(Bun.argv)

  // Handle --help
  if (args.help) {
    console.log(HELP_TEXT)
    process.exit(0)
  }

  // Handle --version
  if (args.version) {
    console.log(`orch v${VERSION}`)
    process.exit(0)
  }

  // Validate project path exists
  if (!existsSync(args.projectPath)) {
    console.error(`Error: Project path does not exist: ${args.projectPath}`)
    process.exit(1)
  }

  // Load config to get the plan file name (defaults to PLAN.md)
  let planFileName = 'PLAN.md'
  try {
    const config = await loadConfig(args.projectPath)
    planFileName = config.planFile
  } catch {
    // Config load failed, use default plan file name
  }

  // Validate PLAN.md exists
  const planPath = join(args.projectPath, planFileName)
  if (!existsSync(planPath)) {
    console.error(`Error: ${planFileName} not found in ${args.projectPath}`)
    console.error('')
    console.error('ORCH requires a PLAN.md file to orchestrate work.')
    console.error('Create a PLAN.md file or use a different project directory.')
    process.exit(1)
  }

  // Register graceful shutdown handlers for SIGINT/SIGTERM
  // Note: Full shutdown integration with Orchestrator will be added when T008 is complete
  // For now, we register handlers that will work with App-level cleanup
  registerShutdownHandlers({
    onShutdownStart: () => {
      // The App will handle its own cleanup when process exits
      // This is called before the process.exit(0) in shutdown.ts
    },
    onShutdownComplete: (summary) => {
      console.log('\n')
      console.log('=== ORCH Shutdown Summary ===')
      console.log(`Agents stopped: ${summary.agentsStopped}`)
      console.log(`Tickets in progress: ${summary.ticketsInProgress}`)
      if (summary.totalCost > 0) {
        console.log(`Total cost: $${summary.totalCost.toFixed(4)}`)
      }
      console.log('Goodbye!')
    },
  })

  // Start the TUI app
  const app = new App()
  await app.start()
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
