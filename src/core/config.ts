/**
 * Configuration System
 *
 * Loads and validates ORCH configuration from file and environment.
 *
 * Implements: T017
 */

import type { OrchConfig, AutomationMode } from './types';

const DEFAULT_CONFIG: OrchConfig = {
  maxAgents: 5,
  agentModel: 'sonnet',
  planFile: 'PLAN.md',
  logLevel: 'info',
  automation: {
    ticketProgression: 'automatic',
    review: { mode: 'automatic' },
    qa: { mode: 'automatic' },
  },
};

export interface ConfigError {
  path: string;
  message: string;
}

/**
 * Load configuration from file and environment
 */
export async function loadConfig(projectPath: string): Promise<OrchConfig> {
  // TODO: Implement - T017
  // - Look for .orchrc or orch.config.json
  // - Parse and validate
  // - Merge with defaults
  // - Apply environment overrides
  throw new Error('Not implemented');
}

/**
 * Validate configuration object
 */
export function validateConfig(config: unknown): ConfigError[] {
  // TODO: Implement - T017
  // - Check required fields
  // - Validate types
  // - Validate enum values (automation modes)
  // - Return list of errors
  throw new Error('Not implemented');
}

/**
 * Get environment variable overrides
 * ORCH_MAX_AGENTS, ORCH_LOG_LEVEL, etc.
 */
export function getEnvOverrides(): Partial<OrchConfig> {
  // TODO: Implement - T017
  const overrides: Partial<OrchConfig> = {};

  if (process.env.ORCH_MAX_AGENTS) {
    overrides.maxAgents = parseInt(process.env.ORCH_MAX_AGENTS, 10);
  }

  if (process.env.ORCH_LOG_LEVEL) {
    overrides.logLevel = process.env.ORCH_LOG_LEVEL as OrchConfig['logLevel'];
  }

  if (process.env.ORCH_AGENT_MODEL) {
    overrides.agentModel = process.env.ORCH_AGENT_MODEL;
  }

  return overrides;
}

/**
 * Merge configs with proper deep merge for nested objects
 */
export function mergeConfigs(
  base: OrchConfig,
  ...overrides: Partial<OrchConfig>[]
): OrchConfig {
  // TODO: Implement - T017
  // - Deep merge objects
  // - Handle automation nested config
  throw new Error('Not implemented');
}

/**
 * Watch config file for changes
 */
export function watchConfig(
  projectPath: string,
  onChange: (config: OrchConfig) => void
): () => void {
  // TODO: Implement - T017 (hot reload)
  // - Set up file watcher
  // - Reload and validate on change
  // - Call onChange if valid
  // - Return unwatch function
  throw new Error('Not implemented');
}

/**
 * Get default configuration
 */
export function getDefaultConfig(): OrchConfig {
  return { ...DEFAULT_CONFIG };
}
