/**
 * Error Recovery Tests
 *
 * Tests for T018: Error Recovery functionality
 */

import { describe, expect, test, beforeEach, mock, spyOn } from 'bun:test';
import {
  calculateBackoff,
  sleep,
  withRetry,
  isRetryableError,
  logError,
  logMalformedOutput,
  logAgentCrash,
  logPlanParseError,
  graceful,
  gracefulSync,
  OrchError,
  AgentCrashError,
  NetworkError,
  MalformedOutputError,
  PlanParseError,
  DEFAULT_ERROR_RECOVERY_CONFIG,
} from './error-recovery';
import { resetEventBus, getEventBus } from './events';
import type { OrchEvent } from './types';

// =============================================================================
// Error Classes Tests
// =============================================================================

describe('Error Classes', () => {
  describe('OrchError', () => {
    test('creates error with message', () => {
      const error = new OrchError('Test error');
      expect(error.message).toBe('Test error');
      expect(error.name).toBe('OrchError');
    });

    test('creates error with context', () => {
      const error = new OrchError('Test error', { key: 'value' });
      expect(error.context).toEqual({ key: 'value' });
    });
  });

  describe('AgentCrashError', () => {
    test('creates crash error with details', () => {
      const error = new AgentCrashError(
        'Agent crashed',
        'agent-1',
        'T001',
        1
      );
      expect(error.message).toBe('Agent crashed');
      expect(error.agentId).toBe('agent-1');
      expect(error.ticketId).toBe('T001');
      expect(error.exitCode).toBe(1);
      expect(error.name).toBe('AgentCrashError');
    });
  });

  describe('NetworkError', () => {
    test('creates retryable network error', () => {
      const error = new NetworkError('Connection reset', true);
      expect(error.retryable).toBe(true);
    });

    test('creates non-retryable network error', () => {
      const error = new NetworkError('Auth failed', false);
      expect(error.retryable).toBe(false);
    });
  });

  describe('MalformedOutputError', () => {
    test('creates error with output preview', () => {
      const error = new MalformedOutputError(
        'Invalid marker',
        'agent-1',
        'Some output text here'
      );
      expect(error.agentId).toBe('agent-1');
      expect(error.output).toBe('Some output text here');
    });
  });

  describe('PlanParseError', () => {
    test('creates parse error with line number', () => {
      const error = new PlanParseError(
        'Missing status field',
        '/path/to/PLAN.md',
        42
      );
      expect(error.planPath).toBe('/path/to/PLAN.md');
      expect(error.line).toBe(42);
    });
  });
});

// =============================================================================
// Backoff Utilities Tests
// =============================================================================

describe('Backoff Utilities', () => {
  describe('calculateBackoff', () => {
    test('returns initial delay for attempt 0', () => {
      const delay = calculateBackoff(0, {
        initialBackoffMs: 1000,
        backoffMultiplier: 2,
        maxBackoffMs: 30000,
      });
      // Should be ~1000ms with up to 20% jitter
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(1200);
    });

    test('increases delay exponentially', () => {
      const config = {
        initialBackoffMs: 1000,
        backoffMultiplier: 2,
        maxBackoffMs: 100000,
      };

      const delay0 = calculateBackoff(0, config);
      const delay1 = calculateBackoff(1, config);
      const delay2 = calculateBackoff(2, config);

      // Each delay should be approximately double (with jitter)
      expect(delay1).toBeGreaterThan(delay0);
      expect(delay2).toBeGreaterThan(delay1);
    });

    test('caps at maxBackoffMs', () => {
      const delay = calculateBackoff(10, {
        initialBackoffMs: 1000,
        backoffMultiplier: 2,
        maxBackoffMs: 5000,
      });
      expect(delay).toBeLessThanOrEqual(5000);
    });

    test('uses default config when not provided', () => {
      const delay = calculateBackoff(0);
      // Default initialBackoffMs is 1000
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(1200);
    });
  });

  describe('sleep', () => {
    test('sleeps for specified duration', async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;
      // Should be at least 50ms (with some tolerance for timing)
      expect(elapsed).toBeGreaterThanOrEqual(45);
    });
  });
});

// =============================================================================
// Retry Utilities Tests
// =============================================================================

describe('Retry Utilities', () => {
  describe('isRetryableError', () => {
    test('NetworkError with retryable=true is retryable', () => {
      const error = new NetworkError('timeout', true);
      expect(isRetryableError(error)).toBe(true);
    });

    test('NetworkError with retryable=false is not retryable', () => {
      const error = new NetworkError('auth failed', false);
      expect(isRetryableError(error)).toBe(false);
    });

    test('AgentCrashError is retryable', () => {
      const error = new AgentCrashError('crash', 'agent-1');
      expect(isRetryableError(error)).toBe(true);
    });

    test('timeout errors are retryable', () => {
      const error = new Error('connection timeout occurred');
      expect(isRetryableError(error)).toBe(true);
    });

    test('connection reset errors are retryable', () => {
      const error = new Error('ECONNRESET');
      expect(isRetryableError(error)).toBe(true);
    });

    test('rate limit (429) errors are retryable', () => {
      const error = new Error('HTTP 429 Too Many Requests');
      expect(isRetryableError(error)).toBe(true);
    });

    test('server errors (5xx) are retryable', () => {
      const error500 = new Error('HTTP 500 Internal Server Error');
      const error503 = new Error('HTTP 503 Service Unavailable');
      expect(isRetryableError(error500)).toBe(true);
      expect(isRetryableError(error503)).toBe(true);
    });

    test('non-retryable errors return false', () => {
      const error = new Error('Some random error');
      expect(isRetryableError(error)).toBe(false);
    });
  });

  describe('withRetry', () => {
    beforeEach(() => {
      resetEventBus();
    });

    test('returns result on first success', async () => {
      const fn = mock(() => Promise.resolve('success'));

      const result = await withRetry(fn, { maxRetries: 3 });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('retries on failure and succeeds', async () => {
      let attempts = 0;
      const fn = mock(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new NetworkError('timeout', true));
        }
        return Promise.resolve('success');
      });

      const result = await withRetry(fn, {
        maxRetries: 3,
        initialBackoffMs: 1, // Fast for testing
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    test('throws after exhausting retries', async () => {
      const fn = mock(() => Promise.reject(new NetworkError('timeout', true)));

      await expect(
        withRetry(fn, {
          maxRetries: 2,
          initialBackoffMs: 1,
        })
      ).rejects.toThrow('timeout');

      // Initial attempt + 2 retries = 3 calls
      expect(fn).toHaveBeenCalledTimes(3);
    });

    test('does not retry non-retryable errors', async () => {
      const fn = mock(() => Promise.reject(new Error('non-retryable error')));

      await expect(
        withRetry(fn, {
          maxRetries: 3,
          initialBackoffMs: 1,
        })
      ).rejects.toThrow('non-retryable error');

      // Should only be called once
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('calls onRetry callback', async () => {
      let attempts = 0;
      const fn = mock(() => {
        attempts++;
        if (attempts < 2) {
          return Promise.reject(new NetworkError('timeout', true));
        }
        return Promise.resolve('success');
      });

      const onRetry = mock(() => {});

      await withRetry(fn, {
        maxRetries: 3,
        initialBackoffMs: 1,
        onRetry,
      });

      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    test('respects custom isRetryable function', async () => {
      const fn = mock(() => Promise.reject(new Error('custom error')));

      // Custom function that considers all errors retryable
      const isRetryable = mock(() => true);

      await expect(
        withRetry(fn, {
          maxRetries: 2,
          initialBackoffMs: 1,
          isRetryable,
        })
      ).rejects.toThrow('custom error');

      expect(fn).toHaveBeenCalledTimes(3);
    });
  });
});

// =============================================================================
// Error Logging Tests
// =============================================================================

describe('Error Logging', () => {
  let events: OrchEvent[];

  beforeEach(() => {
    resetEventBus();
    events = [];
    getEventBus().subscribeAll((event) => {
      events.push(event);
    });
  });

  describe('logError', () => {
    test('logs OrchError with context', () => {
      const error = new OrchError('Test error', { key: 'value' });
      logError(error, 'error', { extra: 'context' });

      expect(events).toHaveLength(1);
      const event = events[0] as any;
      expect(event.type).toBe('log:entry');
      expect(event.level).toBe('error');
      expect(event.message).toBe('Test error');
      expect(event.data?.key).toBe('value');
      expect(event.data?.extra).toBe('context');
    });

    test('logs plain Error with stack trace', () => {
      const error = new Error('Plain error');
      logError(error, 'warn');

      const event = events[0] as any;
      expect(event.message).toBe('Plain error');
      expect(event.data?.errorName).toBe('Error');
      expect(event.data?.stack).toBeDefined();
    });

    test('logs string error', () => {
      logError('String error', 'info');

      const event = events[0] as any;
      expect(event.message).toBe('String error');
    });

    test('logs with agent and ticket IDs', () => {
      logError(new Error('test'), 'error', {
        agentId: 'agent-1',
        ticketId: 'T001',
      });

      const event = events[0] as any;
      expect(event.agentId).toBe('agent-1');
      expect(event.ticketId).toBe('T001');
    });
  });

  describe('logMalformedOutput', () => {
    test('logs warning for malformed output', () => {
      logMalformedOutput('agent-1', 'some output', 'missing marker');

      expect(events).toHaveLength(1);
      const event = events[0] as any;
      expect(event.level).toBe('warn');
      expect(event.data?.agentId).toBe('agent-1');
      expect(event.data?.reason).toBe('missing marker');
    });
  });

  describe('logAgentCrash', () => {
    test('logs error for agent crash', () => {
      logAgentCrash('agent-1', 'T001', new Error('crash'), 1);

      expect(events).toHaveLength(1);
      const event = events[0] as any;
      expect(event.level).toBe('error');
      expect(event.data?.agentId).toBe('agent-1');
      expect(event.data?.ticketId).toBe('T001');
      expect(event.data?.exitCode).toBe(1);
      expect(event.data?.crashType).toBe('agent');
    });
  });

  describe('logPlanParseError', () => {
    test('logs error for plan parse failure', () => {
      logPlanParseError('/path/to/PLAN.md', new Error('parse failed'), 42);

      expect(events).toHaveLength(1);
      const event = events[0] as any;
      expect(event.level).toBe('error');
      expect(event.data?.planPath).toBe('/path/to/PLAN.md');
      expect(event.data?.line).toBe(42);
      expect(event.data?.preventOrchestration).toBe(true);
    });
  });
});

// =============================================================================
// Graceful Error Handling Tests
// =============================================================================

describe('Graceful Error Handling', () => {
  beforeEach(() => {
    resetEventBus();
  });

  describe('graceful', () => {
    test('returns result on success', async () => {
      const result = await graceful(() => Promise.resolve('success'));
      expect(result).toBe('success');
    });

    test('returns undefined on error', async () => {
      const result = await graceful(() => Promise.reject(new Error('fail')));
      expect(result).toBeUndefined();
    });

    test('logs error on failure', async () => {
      const events: OrchEvent[] = [];
      getEventBus().subscribeAll((event) => events.push(event));

      await graceful(() => Promise.reject(new Error('fail')));

      expect(events).toHaveLength(1);
      const event = events[0] as any;
      expect(event.level).toBe('warn');
      expect(event.data?.gracefulCatch).toBe(true);
    });
  });

  describe('gracefulSync', () => {
    test('returns result on success', () => {
      const result = gracefulSync(() => 'success');
      expect(result).toBe('success');
    });

    test('returns undefined on error', () => {
      const result = gracefulSync(() => {
        throw new Error('fail');
      });
      expect(result).toBeUndefined();
    });
  });
});

// =============================================================================
// Default Config Tests
// =============================================================================

describe('DEFAULT_ERROR_RECOVERY_CONFIG', () => {
  test('has expected default values', () => {
    expect(DEFAULT_ERROR_RECOVERY_CONFIG.maxRetries).toBe(3);
    expect(DEFAULT_ERROR_RECOVERY_CONFIG.initialBackoffMs).toBe(1000);
    expect(DEFAULT_ERROR_RECOVERY_CONFIG.maxBackoffMs).toBe(30000);
    expect(DEFAULT_ERROR_RECOVERY_CONFIG.backoffMultiplier).toBe(2);
    expect(DEFAULT_ERROR_RECOVERY_CONFIG.autoRetryFailed).toBe(false);
  });
});
