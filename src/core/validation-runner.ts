/**
 * Validation Runner
 *
 * Executes ticket validation steps after agent reports completion.
 * Runs commands, checks exit codes, and reports results.
 *
 * Implements: T009
 */

import type { Ticket, ValidationResult } from './types';

// Default timeout per step (60 seconds)
const DEFAULT_STEP_TIMEOUT = 60_000;

export interface ValidationStepResult {
  command: string;
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  timedOut: boolean;
}

export interface ValidationOptions {
  /** Timeout per step in milliseconds (default: 60000) */
  stepTimeout?: number;
  /** Working directory for commands */
  workingDir?: string;
}

/**
 * Run a single validation command
 *
 * @param command - The shell command to execute
 * @param workingDir - Working directory for the command
 * @param timeout - Timeout in milliseconds (default: 60000)
 * @returns ValidationStepResult with exit code, output, and timing
 */
export async function runValidationStep(
  command: string,
  workingDir: string,
  timeout: number = DEFAULT_STEP_TIMEOUT
): Promise<ValidationStepResult> {
  const startTime = Date.now();

  try {
    // Use Bun.spawn to run the command
    const proc = Bun.spawn(['sh', '-c', command], {
      cwd: workingDir,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Create a timeout promise
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), timeout);
    });

    // Race between process completion and timeout
    const exitedPromise = proc.exited.then(() => 'completed' as const);
    const result = await Promise.race([exitedPromise, timeoutPromise]);

    const duration = Date.now() - startTime;

    if (result === 'timeout') {
      // Kill the process on timeout
      proc.kill();
      return {
        command,
        passed: false,
        exitCode: -1,
        stdout: '',
        stderr: `Command timed out after ${timeout}ms`,
        duration,
        timedOut: true,
      };
    }

    // Process completed - collect output
    const exitCode = proc.exitCode ?? -1;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    return {
      command,
      passed: exitCode === 0,
      exitCode,
      stdout,
      stderr,
      duration,
      timedOut: false,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      command,
      passed: false,
      exitCode: -1,
      stdout: '',
      stderr: `Execution error: ${errorMessage}`,
      duration,
      timedOut: false,
    };
  }
}

/**
 * Parse validation steps from ticket
 *
 * Validation steps can be raw commands or markdown code blocks.
 * Examples:
 *   - `bun run typecheck`
 *   - Run `bun test`
 *   - ```bash\nbun run build\n```
 *
 * @param ticket - The ticket containing validation steps
 * @returns Array of extracted commands
 */
export function parseValidationSteps(ticket: Ticket): string[] {
  const commands: string[] = [];

  for (const step of ticket.validationSteps) {
    // Try to extract from code block FIRST (```bash or ```sh or just ```)
    // Must check triple backticks before single backticks
    const codeBlockMatch = step.match(/```(?:bash|sh|shell)?\n([\s\S]*?)```/);
    if (codeBlockMatch) {
      commands.push(codeBlockMatch[1].trim());
      continue;
    }

    // Try to extract command from single backticks
    const backtickMatch = step.match(/`([^`]+)`/);
    if (backtickMatch) {
      commands.push(backtickMatch[1].trim());
      continue;
    }

    // If the step looks like a raw command (starts with common executables), use it directly
    const trimmed = step.trim();
    if (
      trimmed.startsWith('bun ') ||
      trimmed.startsWith('npm ') ||
      trimmed.startsWith('node ') ||
      trimmed.startsWith('pnpm ') ||
      trimmed.startsWith('yarn ') ||
      trimmed.startsWith('./') ||
      trimmed.startsWith('sh ') ||
      trimmed.startsWith('bash ')
    ) {
      commands.push(trimmed);
    }
    // Otherwise skip - it's likely a description, not a command
  }

  return commands;
}

/**
 * Run all validation steps for a ticket
 *
 * Executes each validation step in sequence, capturing results.
 * Stops on first failure if stopOnFailure is true.
 *
 * @param ticket - The ticket to validate
 * @param workingDir - Working directory for commands
 * @param options - Additional options
 * @returns ValidationResult with all step results
 */
export async function runValidation(
  ticket: Ticket,
  workingDir: string,
  options: ValidationOptions = {}
): Promise<ValidationResult> {
  const { stepTimeout = DEFAULT_STEP_TIMEOUT } = options;
  const startTime = Date.now();

  const commands = parseValidationSteps(ticket);
  const steps: ValidationResult['steps'] = [];
  let allPassed = true;

  for (const command of commands) {
    const result = await runValidationStep(command, workingDir, stepTimeout);

    steps.push({
      command: result.command,
      passed: result.passed,
      output: result.timedOut
        ? result.stderr
        : result.stdout + (result.stderr ? `\n[stderr]: ${result.stderr}` : ''),
      duration: result.duration,
    });

    if (!result.passed) {
      allPassed = false;
      // Continue running remaining steps to gather all results
    }
  }

  const totalDuration = Date.now() - startTime;

  return {
    passed: allPassed,
    steps,
    totalDuration,
  };
}

/**
 * Format validation result for display/logging
 */
export function formatValidationResult(result: ValidationResult): string {
  const lines: string[] = [];

  lines.push(`Validation ${result.passed ? 'PASSED' : 'FAILED'}`);
  lines.push(`Total duration: ${result.totalDuration}ms`);
  lines.push('');

  for (const step of result.steps) {
    const status = step.passed ? '[PASS]' : '[FAIL]';
    lines.push(`${status} ${step.command} (${step.duration}ms)`);
    if (!step.passed && step.output) {
      // Indent output
      const indented = step.output
        .split('\n')
        .map((line) => `    ${line}`)
        .join('\n');
      lines.push(indented);
    }
  }

  return lines.join('\n');
}
