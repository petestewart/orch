/**
 * Error Recovery Module
 *
 * Provides utilities for handling errors gracefully:
 * - Exponential backoff for retries
 * - Contextual error logging
 * - Agent crash/failure handling
 *
 * Implements: T018
 */

import { getEventBus } from './events';
import type { ErrorRecoveryConfig } from './types';

// =============================================================================
// Default Configuration
// =============================================================================

export const DEFAULT_ERROR_RECOVERY_CONFIG: ErrorRecoveryConfig = {
  maxRetries: 3,
  initialBackoffMs: 1000,
  maxBackoffMs: 30000,
  backoffMultiplier: 2,
  autoRetryFailed: false,
};

// =============================================================================
// Error Types
// =============================================================================

/**
 * Base error class for ORCH-specific errors
 */
export class OrchError extends Error {
  constructor(
    message: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'OrchError';
  }
}

/**
 * Error thrown when an agent crashes or fails unexpectedly
 */
export class AgentCrashError extends OrchError {
  constructor(
    message: string,
    public readonly agentId: string,
    public readonly ticketId?: string,
    public readonly exitCode?: number,
    context?: Record<string, unknown>
  ) {
    super(message, { ...context, agentId, ticketId, exitCode });
    this.name = 'AgentCrashError';
  }
}

/**
 * Error thrown when network/communication fails
 */
export class NetworkError extends OrchError {
  constructor(
    message: string,
    public readonly retryable: boolean = true,
    context?: Record<string, unknown>
  ) {
    super(message, { ...context, retryable });
    this.name = 'NetworkError';
  }
}

/**
 * Error thrown when agent output is malformed
 */
export class MalformedOutputError extends OrchError {
  constructor(
    message: string,
    public readonly agentId: string,
    public readonly output?: string,
    context?: Record<string, unknown>
  ) {
    super(message, { ...context, agentId, outputPreview: output?.slice(0, 200) });
    this.name = 'MalformedOutputError';
  }
}

/**
 * Error thrown when plan parsing fails
 */
export class PlanParseError extends OrchError {
  constructor(
    message: string,
    public readonly planPath: string,
    public readonly line?: number,
    context?: Record<string, unknown>
  ) {
    // Include line number in message for backward compatibility
    const fullMessage = line !== undefined
      ? `Parse error at line ${line}: ${message}`
      : message;
    super(fullMessage, { ...context, planPath, line });
    this.name = 'PlanParseError';
  }
}

// =============================================================================
// Backoff Utilities
// =============================================================================

/**
 * Calculate exponential backoff delay
 * @param attempt - The attempt number (0-indexed)
 * @param config - Error recovery configuration
 * @returns Delay in milliseconds
 */
export function calculateBackoff(
  attempt: number,
  config: Partial<ErrorRecoveryConfig> = {}
): number {
  const {
    initialBackoffMs = DEFAULT_ERROR_RECOVERY_CONFIG.initialBackoffMs,
    maxBackoffMs = DEFAULT_ERROR_RECOVERY_CONFIG.maxBackoffMs,
    backoffMultiplier = DEFAULT_ERROR_RECOVERY_CONFIG.backoffMultiplier,
  } = config;

  // Calculate base delay with exponential backoff
  const baseDelay = initialBackoffMs * Math.pow(backoffMultiplier, attempt);

  // Add jitter (0-20% of base delay) to prevent thundering herd
  const jitter = Math.random() * 0.2 * baseDelay;

  // Cap at maxBackoffMs
  return Math.min(baseDelay + jitter, maxBackoffMs);
}

/**
 * Sleep for a specified duration
 * @param ms - Duration in milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// Retry Utilities
// =============================================================================

export interface RetryOptions {
  /** Maximum number of retry attempts */
  maxRetries?: number;
  /** Initial backoff delay in milliseconds */
  initialBackoffMs?: number;
  /** Maximum backoff delay in milliseconds */
  maxBackoffMs?: number;
  /** Backoff multiplier */
  backoffMultiplier?: number;
  /** Function to determine if error is retryable */
  isRetryable?: (error: unknown) => boolean;
  /** Callback called before each retry */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
  /** Context for error logging */
  context?: Record<string, unknown>;
}

/**
 * Default function to check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  // Network errors are generally retryable
  if (error instanceof NetworkError) {
    return error.retryable;
  }

  // Agent crashes can be retried
  if (error instanceof AgentCrashError) {
    return true;
  }

  // Check for common retryable error patterns
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Retryable patterns
    const retryablePatterns = [
      'timeout',
      'timed out',
      'econnreset',
      'econnrefused',
      'enotfound',
      'epipe',
      'network',
      'socket hang up',
      'connection reset',
      'connection refused',
      'temporary',
      'unavailable',
      '429', // Rate limit
      '500', // Server error
      '502', // Bad gateway
      '503', // Service unavailable
      '504', // Gateway timeout
    ];

    return retryablePatterns.some(pattern => message.includes(pattern));
  }

  return false;
}

/**
 * Execute a function with retry logic and exponential backoff
 * @param fn - Function to execute
 * @param options - Retry options
 * @returns Result of the function
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = DEFAULT_ERROR_RECOVERY_CONFIG.maxRetries,
    isRetryable = isRetryableError,
    onRetry,
    context,
    ...backoffConfig
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we've exhausted retries
      if (attempt >= maxRetries) {
        break;
      }

      // Check if error is retryable
      if (!isRetryable(error)) {
        break;
      }

      // Calculate backoff delay
      const delayMs = calculateBackoff(attempt, backoffConfig);

      // Call retry callback
      if (onRetry) {
        onRetry(attempt + 1, error, delayMs);
      }

      // Log retry attempt
      logError(error, 'warn', {
        ...context,
        attempt: attempt + 1,
        maxRetries,
        nextRetryDelayMs: delayMs,
        message: `Retrying after error (attempt ${attempt + 1}/${maxRetries})`,
      });

      // Wait before retrying
      await sleep(delayMs);
    }
  }

  // All retries exhausted - log and rethrow
  logError(lastError, 'error', {
    ...context,
    exhaustedRetries: true,
    totalAttempts: maxRetries + 1,
    message: 'All retry attempts exhausted',
  });

  throw lastError;
}

// =============================================================================
// Error Logging
// =============================================================================

/**
 * Log level type
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Log an error with context to the event bus
 * @param error - The error to log
 * @param level - Log level (default: 'error')
 * @param context - Additional context
 */
export function logError(
  error: unknown,
  level: LogLevel = 'error',
  context?: Record<string, unknown>
): void {
  const eventBus = getEventBus();

  // Extract error details
  let message = 'Unknown error';
  let errorContext: Record<string, unknown> = {};

  if (error instanceof OrchError) {
    message = error.message;
    errorContext = error.context || {};
  } else if (error instanceof Error) {
    message = error.message;
    errorContext = {
      errorName: error.name,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'), // First 5 lines of stack
    };
  } else if (typeof error === 'string') {
    message = error;
  } else {
    message = String(error);
  }

  // Merge contexts
  const mergedContext = {
    ...errorContext,
    ...context,
  };

  // Publish log event
  eventBus.publish({
    type: 'log:entry',
    timestamp: new Date(),
    level,
    message,
    data: Object.keys(mergedContext).length > 0 ? mergedContext : undefined,
    agentId: context?.agentId as string | undefined,
    ticketId: context?.ticketId as string | undefined,
  });
}

/**
 * Log a warning about malformed output (non-fatal)
 */
export function logMalformedOutput(
  agentId: string,
  output: string,
  reason: string
): void {
  logError(
    new MalformedOutputError(reason, agentId, output),
    'warn',
    {
      agentId,
      reason,
      outputLength: output.length,
      outputPreview: output.slice(0, 500),
    }
  );
}

/**
 * Log an agent crash with full context
 */
export function logAgentCrash(
  agentId: string,
  ticketId: string | undefined,
  error: unknown,
  exitCode?: number
): void {
  const crashError = error instanceof AgentCrashError
    ? error
    : new AgentCrashError(
        error instanceof Error ? error.message : String(error),
        agentId,
        ticketId,
        exitCode
      );

  logError(crashError, 'error', {
    agentId,
    ticketId,
    exitCode,
    crashType: 'agent',
  });
}

/**
 * Log a plan parse error (prevents orchestration from starting)
 */
export function logPlanParseError(
  planPath: string,
  error: unknown,
  line?: number
): void {
  const parseError = error instanceof PlanParseError
    ? error
    : new PlanParseError(
        error instanceof Error ? error.message : String(error),
        planPath,
        line
      );

  logError(parseError, 'error', {
    planPath,
    line,
    parseError: true,
    preventOrchestration: true,
  });
}

// =============================================================================
// Graceful Error Handling
// =============================================================================

/**
 * Wrap a function to catch and log errors gracefully
 * Returns undefined on error (non-throwing)
 */
export async function graceful<T>(
  fn: () => Promise<T>,
  context?: Record<string, unknown>
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    logError(error, 'warn', {
      ...context,
      gracefulCatch: true,
    });
    return undefined;
  }
}

/**
 * Wrap a sync function to catch and log errors gracefully
 * Returns undefined on error (non-throwing)
 */
export function gracefulSync<T>(
  fn: () => T,
  context?: Record<string, unknown>
): T | undefined {
  try {
    return fn();
  } catch (error) {
    logError(error, 'warn', {
      ...context,
      gracefulCatch: true,
    });
    return undefined;
  }
}
