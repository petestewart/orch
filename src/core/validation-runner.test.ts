/**
 * Unit tests for Validation Runner
 * Implements: T009 validation
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import {
  runValidationStep,
  runValidation,
  parseValidationSteps,
  formatValidationResult,
} from './validation-runner';
import type { Ticket } from './types';

// Get the current working directory for tests
const testDir = process.cwd();

describe('runValidationStep', () => {
  test('runs a successful command and returns passed=true', async () => {
    const result = await runValidationStep('echo hello', testDir);

    expect(result.passed).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello');
    expect(result.timedOut).toBe(false);
    expect(result.duration).toBeGreaterThan(0);
  });

  test('runs a failing command and returns passed=false', async () => {
    const result = await runValidationStep('exit 1', testDir);

    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
  });

  test('captures stderr output', async () => {
    const result = await runValidationStep('echo error >&2', testDir);

    expect(result.stderr.trim()).toBe('error');
  });

  test('handles timeout correctly', async () => {
    // Use a very short timeout (100ms) with a command that would take longer
    const result = await runValidationStep('sleep 10', testDir, 100);

    expect(result.passed).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(-1);
    expect(result.stderr).toContain('timed out');
  });

  test('handles non-existent command gracefully', async () => {
    const result = await runValidationStep('nonexistent_command_12345', testDir);

    expect(result.passed).toBe(false);
    expect(result.exitCode).not.toBe(0);
  });

  test('respects working directory', async () => {
    const result = await runValidationStep('pwd', '/tmp');

    expect(result.passed).toBe(true);
    expect(result.stdout.trim()).toBe('/tmp');
  });

  test('captures multi-line output', async () => {
    const result = await runValidationStep('echo "line1"; echo "line2"', testDir);

    expect(result.passed).toBe(true);
    const lines = result.stdout.trim().split('\n');
    expect(lines).toEqual(['line1', 'line2']);
  });
});

describe('parseValidationSteps', () => {
  const createTicket = (validationSteps: string[]): Ticket => ({
    id: 'T001',
    title: 'Test Ticket',
    priority: 'P0',
    status: 'InProgress',
    dependencies: [],
    acceptanceCriteria: [],
    validationSteps,
  });

  test('extracts command from backticks', () => {
    const ticket = createTicket(['Run `bun run typecheck` to verify types']);
    const commands = parseValidationSteps(ticket);

    expect(commands).toEqual(['bun run typecheck']);
  });

  test('extracts multiple backticked commands', () => {
    const ticket = createTicket([
      '`bun run typecheck` passes',
      'Run `bun test` to verify',
      '`npm run build`',
    ]);
    const commands = parseValidationSteps(ticket);

    expect(commands).toEqual(['bun run typecheck', 'bun test', 'npm run build']);
  });

  test('extracts command from code block', () => {
    const ticket = createTicket(['```bash\nbun run build\n```']);
    const commands = parseValidationSteps(ticket);

    expect(commands).toEqual(['bun run build']);
  });

  test('handles raw commands starting with known executables', () => {
    const ticket = createTicket([
      'bun run test',
      'npm run lint',
      './scripts/validate.sh',
    ]);
    const commands = parseValidationSteps(ticket);

    expect(commands).toEqual(['bun run test', 'npm run lint', './scripts/validate.sh']);
  });

  test('skips descriptive text without commands', () => {
    const ticket = createTicket([
      'Verify the code compiles',
      '`bun run typecheck` passes',
      'Check that tests pass',
    ]);
    const commands = parseValidationSteps(ticket);

    expect(commands).toEqual(['bun run typecheck']);
  });

  test('handles empty validation steps', () => {
    const ticket = createTicket([]);
    const commands = parseValidationSteps(ticket);

    expect(commands).toEqual([]);
  });
});

describe('runValidation', () => {
  const createTicket = (validationSteps: string[]): Ticket => ({
    id: 'T001',
    title: 'Test Ticket',
    priority: 'P0',
    status: 'InProgress',
    dependencies: [],
    acceptanceCriteria: [],
    validationSteps,
  });

  test('runs all validation steps and returns overall result', async () => {
    const ticket = createTicket(['`echo step1`', '`echo step2`']);
    const result = await runValidation(ticket, testDir);

    expect(result.passed).toBe(true);
    expect(result.steps.length).toBe(2);
    expect(result.steps[0].passed).toBe(true);
    expect(result.steps[1].passed).toBe(true);
    expect(result.totalDuration).toBeGreaterThan(0);
  });

  test('returns passed=false if any step fails', async () => {
    const ticket = createTicket(['`echo success`', '`exit 1`', '`echo after`']);
    const result = await runValidation(ticket, testDir);

    expect(result.passed).toBe(false);
    expect(result.steps.length).toBe(3);
    expect(result.steps[0].passed).toBe(true);
    expect(result.steps[1].passed).toBe(false);
    // Continues to run remaining steps
    expect(result.steps[2].passed).toBe(true);
  });

  test('handles timeout in validation steps', async () => {
    const ticket = createTicket(['`sleep 10`']);
    const result = await runValidation(ticket, testDir, { stepTimeout: 100 });

    expect(result.passed).toBe(false);
    expect(result.steps[0].passed).toBe(false);
    expect(result.steps[0].output).toContain('timed out');
  });

  test('handles empty validation steps', async () => {
    const ticket = createTicket([]);
    const result = await runValidation(ticket, testDir);

    expect(result.passed).toBe(true);
    expect(result.steps.length).toBe(0);
  });

  test('captures output in step results', async () => {
    const ticket = createTicket(['`echo hello world`']);
    const result = await runValidation(ticket, testDir);

    expect(result.steps[0].output.trim()).toBe('hello world');
  });

  test('includes stderr in output for failed steps', async () => {
    const ticket = createTicket(['`echo error >&2 && exit 1`']);
    const result = await runValidation(ticket, testDir);

    expect(result.passed).toBe(false);
    expect(result.steps[0].output).toContain('error');
  });
});

describe('formatValidationResult', () => {
  test('formats passed result correctly', () => {
    const result = {
      passed: true,
      steps: [
        { command: 'echo test', passed: true, output: 'test', duration: 10 },
      ],
      totalDuration: 15,
    };

    const formatted = formatValidationResult(result);

    expect(formatted).toContain('PASSED');
    expect(formatted).toContain('[PASS]');
    expect(formatted).toContain('echo test');
    expect(formatted).toContain('15ms');
  });

  test('formats failed result with output', () => {
    const result = {
      passed: false,
      steps: [
        { command: 'exit 1', passed: false, output: 'error message', duration: 5 },
      ],
      totalDuration: 10,
    };

    const formatted = formatValidationResult(result);

    expect(formatted).toContain('FAILED');
    expect(formatted).toContain('[FAIL]');
    expect(formatted).toContain('exit 1');
    expect(formatted).toContain('error message');
  });

  test('handles multiple steps', () => {
    const result = {
      passed: false,
      steps: [
        { command: 'echo 1', passed: true, output: '1', duration: 5 },
        { command: 'exit 1', passed: false, output: 'failed', duration: 5 },
        { command: 'echo 3', passed: true, output: '3', duration: 5 },
      ],
      totalDuration: 20,
    };

    const formatted = formatValidationResult(result);

    expect(formatted).toContain('[PASS] echo 1');
    expect(formatted).toContain('[FAIL] exit 1');
    expect(formatted).toContain('[PASS] echo 3');
  });
});
