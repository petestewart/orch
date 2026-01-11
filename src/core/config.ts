/**
 * Configuration System
 *
 * Loads and validates ORCH configuration from file and environment.
 *
 * Implements: T017
 */

import { existsSync, readFileSync, watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import type { OrchConfig, AutomationMode, AutomationConfig, CostLimitConfig, ErrorRecoveryConfig } from './types';

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
  errorRecovery: {
    maxRetries: 3,
    initialBackoffMs: 1000,
    maxBackoffMs: 30000,
    backoffMultiplier: 2,
    autoRetryFailed: false,
  },
};

// Config file names in order of precedence (first found wins)
const CONFIG_FILES = ['.orchrc', 'orch.config.json', 'orch.config.ts'];

export interface ConfigError {
  path: string;
  message: string;
  line?: number;
}

export interface ConfigLoadResult {
  config: OrchConfig;
  configFile?: string;
  errors: ConfigError[];
}

/**
 * Valid automation modes
 */
const VALID_AUTOMATION_MODES: AutomationMode[] = ['automatic', 'approval', 'manual'];

/**
 * Valid log levels
 */
const VALID_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

/**
 * Valid cost limit actions
 */
const VALID_COST_ACTIONS = ['pause', 'warn', 'stop'] as const;

/**
 * Load configuration from file and environment
 */
export async function loadConfig(projectPath: string): Promise<OrchConfig> {
  const result = await loadConfigWithDetails(projectPath);

  if (result.errors.length > 0) {
    const errorMessages = result.errors.map(e => {
      const lineInfo = e.line ? ` (line ${e.line})` : '';
      return `${e.path}${lineInfo}: ${e.message}`;
    }).join('\n');
    throw new Error(`Configuration errors:\n${errorMessages}`);
  }

  return result.config;
}

/**
 * Load configuration with full details (config, source file, errors)
 */
export async function loadConfigWithDetails(projectPath: string): Promise<ConfigLoadResult> {
  const errors: ConfigError[] = [];
  let fileConfig: Partial<OrchConfig> = {};
  let configFile: string | undefined;

  // Find and load config file
  for (const fileName of CONFIG_FILES) {
    const filePath = join(projectPath, fileName);
    if (existsSync(filePath)) {
      configFile = filePath;
      const result = await loadConfigFile(filePath);
      if (result.errors.length > 0) {
        errors.push(...result.errors);
      } else {
        fileConfig = result.config;
      }
      break;
    }
  }

  // Validate the file config if we loaded one
  if (configFile && Object.keys(fileConfig).length > 0) {
    const validationErrors = validateConfig(fileConfig);
    errors.push(...validationErrors);
  }

  // Get environment variable overrides
  const envOverrides = getEnvOverrides();

  // Merge configs: defaults <- file <- env
  const config = mergeConfigs(DEFAULT_CONFIG, fileConfig, envOverrides);

  return { config, configFile, errors };
}

/**
 * Load and parse a config file
 */
async function loadConfigFile(filePath: string): Promise<{ config: Partial<OrchConfig>; errors: ConfigError[] }> {
  const errors: ConfigError[] = [];
  let config: Partial<OrchConfig> = {};

  try {
    const content = readFileSync(filePath, 'utf-8');

    if (filePath.endsWith('.ts')) {
      // For TypeScript config files, we need dynamic import
      // This requires the config to export a default object
      try {
        const imported = await import(filePath);
        config = imported.default || imported;
      } catch (err) {
        errors.push({
          path: filePath,
          message: `Failed to import TypeScript config: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    } else {
      // JSON config (.orchrc or orch.config.json)
      try {
        config = parseJsonWithLineNumbers(content, filePath, errors);
      } catch (err) {
        // Error already added to errors array
      }
    }
  } catch (err) {
    errors.push({
      path: filePath,
      message: `Failed to read config file: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return { config, errors };
}

/**
 * Parse JSON with helpful line number errors
 */
function parseJsonWithLineNumbers(content: string, filePath: string, errors: ConfigError[]): Partial<OrchConfig> {
  try {
    return JSON.parse(content);
  } catch (err) {
    if (err instanceof SyntaxError) {
      // Try to extract line number from the error message
      const match = err.message.match(/position (\d+)/i);
      let line: number | undefined;

      if (match) {
        const position = parseInt(match[1], 10);
        // Count newlines to find line number
        line = content.substring(0, position).split('\n').length;
      }

      errors.push({
        path: filePath,
        message: `Invalid JSON: ${err.message}`,
        line,
      });
    } else {
      errors.push({
        path: filePath,
        message: `Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    return {};
  }
}

/**
 * Validate configuration object
 */
export function validateConfig(config: unknown): ConfigError[] {
  const errors: ConfigError[] = [];

  if (typeof config !== 'object' || config === null) {
    errors.push({ path: '', message: 'Configuration must be an object' });
    return errors;
  }

  const cfg = config as Record<string, unknown>;

  // Validate maxAgents
  if ('maxAgents' in cfg) {
    if (typeof cfg.maxAgents !== 'number' || cfg.maxAgents < 1 || !Number.isInteger(cfg.maxAgents)) {
      errors.push({ path: 'maxAgents', message: 'Must be a positive integer' });
    }
  }

  // Validate agentModel
  if ('agentModel' in cfg) {
    if (typeof cfg.agentModel !== 'string' || cfg.agentModel.trim() === '') {
      errors.push({ path: 'agentModel', message: 'Must be a non-empty string' });
    }
  }

  // Validate planFile
  if ('planFile' in cfg) {
    if (typeof cfg.planFile !== 'string' || cfg.planFile.trim() === '') {
      errors.push({ path: 'planFile', message: 'Must be a non-empty string' });
    }
  }

  // Validate logLevel
  if ('logLevel' in cfg) {
    if (!VALID_LOG_LEVELS.includes(cfg.logLevel as typeof VALID_LOG_LEVELS[number])) {
      errors.push({ path: 'logLevel', message: `Must be one of: ${VALID_LOG_LEVELS.join(', ')}` });
    }
  }

  // Validate automation config
  if ('automation' in cfg) {
    const automationErrors = validateAutomationConfig(cfg.automation);
    errors.push(...automationErrors.map(e => ({ ...e, path: `automation.${e.path}` })));
  }

  // Validate costLimit config
  if ('costLimit' in cfg) {
    const costLimitErrors = validateCostLimitConfig(cfg.costLimit);
    errors.push(...costLimitErrors.map(e => ({ ...e, path: `costLimit.${e.path}` })));
  }

  // Validate errorRecovery config
  if ('errorRecovery' in cfg) {
    const errorRecoveryErrors = validateErrorRecoveryConfig(cfg.errorRecovery);
    errors.push(...errorRecoveryErrors.map(e => ({ ...e, path: `errorRecovery.${e.path}` })));
  }

  // Validate epics config
  if ('epics' in cfg) {
    const epicsErrors = validateEpicsConfig(cfg.epics);
    errors.push(...epicsErrors.map(e => ({ ...e, path: `epics.${e.path}` })));
  }

  // Validate UI config
  if ('ui' in cfg) {
    const uiErrors = validateUiConfig(cfg.ui);
    errors.push(...uiErrors.map(e => ({ ...e, path: `ui.${e.path}` })));
  }

  return errors;
}

/**
 * Validate automation config section
 */
function validateAutomationConfig(automation: unknown): ConfigError[] {
  const errors: ConfigError[] = [];

  if (typeof automation !== 'object' || automation === null) {
    errors.push({ path: '', message: 'Must be an object' });
    return errors;
  }

  const auto = automation as Record<string, unknown>;

  // Validate ticketProgression
  if ('ticketProgression' in auto) {
    if (!VALID_AUTOMATION_MODES.includes(auto.ticketProgression as AutomationMode)) {
      errors.push({
        path: 'ticketProgression',
        message: `Must be one of: ${VALID_AUTOMATION_MODES.join(', ')}`
      });
    }
  }

  // Validate review
  if ('review' in auto) {
    const reviewErrors = validateAutomationModeConfig(auto.review, 'review');
    errors.push(...reviewErrors);
  }

  // Validate qa
  if ('qa' in auto) {
    const qaErrors = validateAutomationModeConfig(auto.qa, 'qa');
    errors.push(...qaErrors);
  }

  // Validate planAudit
  if ('planAudit' in auto) {
    if (typeof auto.planAudit !== 'object' || auto.planAudit === null) {
      errors.push({ path: 'planAudit', message: 'Must be an object' });
    } else {
      const planAudit = auto.planAudit as Record<string, unknown>;
      if ('onRefineViewEntry' in planAudit && typeof planAudit.onRefineViewEntry !== 'boolean') {
        errors.push({ path: 'planAudit.onRefineViewEntry', message: 'Must be a boolean' });
      }
    }
  }

  return errors;
}

/**
 * Validate an automation mode config (review or qa)
 */
function validateAutomationModeConfig(config: unknown, prefix: string): ConfigError[] {
  const errors: ConfigError[] = [];

  if (typeof config !== 'object' || config === null) {
    errors.push({ path: prefix, message: 'Must be an object' });
    return errors;
  }

  const cfg = config as Record<string, unknown>;

  if ('mode' in cfg) {
    if (!VALID_AUTOMATION_MODES.includes(cfg.mode as AutomationMode)) {
      errors.push({
        path: `${prefix}.mode`,
        message: `Must be one of: ${VALID_AUTOMATION_MODES.join(', ')}`
      });
    }
  }

  if ('model' in cfg && cfg.model !== undefined) {
    if (typeof cfg.model !== 'string' || cfg.model.trim() === '') {
      errors.push({ path: `${prefix}.model`, message: 'Must be a non-empty string if specified' });
    }
  }

  return errors;
}

/**
 * Validate cost limit config
 */
function validateCostLimitConfig(costLimit: unknown): ConfigError[] {
  const errors: ConfigError[] = [];

  if (typeof costLimit !== 'object' || costLimit === null) {
    errors.push({ path: '', message: 'Must be an object' });
    return errors;
  }

  const cfg = costLimit as Record<string, unknown>;

  if ('perTicket' in cfg && cfg.perTicket !== undefined) {
    if (typeof cfg.perTicket !== 'number' || cfg.perTicket < 0) {
      errors.push({ path: 'perTicket', message: 'Must be a non-negative number' });
    }
  }

  if ('perSession' in cfg && cfg.perSession !== undefined) {
    if (typeof cfg.perSession !== 'number' || cfg.perSession < 0) {
      errors.push({ path: 'perSession', message: 'Must be a non-negative number' });
    }
  }

  if ('action' in cfg) {
    if (!VALID_COST_ACTIONS.includes(cfg.action as typeof VALID_COST_ACTIONS[number])) {
      errors.push({ path: 'action', message: `Must be one of: ${VALID_COST_ACTIONS.join(', ')}` });
    }
  }

  return errors;
}

/**
 * Validate error recovery config
 */
function validateErrorRecoveryConfig(errorRecovery: unknown): ConfigError[] {
  const errors: ConfigError[] = [];

  if (typeof errorRecovery !== 'object' || errorRecovery === null) {
    errors.push({ path: '', message: 'Must be an object' });
    return errors;
  }

  const cfg = errorRecovery as Record<string, unknown>;

  if ('maxRetries' in cfg) {
    if (typeof cfg.maxRetries !== 'number' || cfg.maxRetries < 0 || !Number.isInteger(cfg.maxRetries)) {
      errors.push({ path: 'maxRetries', message: 'Must be a non-negative integer' });
    }
  }

  if ('initialBackoffMs' in cfg) {
    if (typeof cfg.initialBackoffMs !== 'number' || cfg.initialBackoffMs < 0) {
      errors.push({ path: 'initialBackoffMs', message: 'Must be a non-negative number' });
    }
  }

  if ('maxBackoffMs' in cfg) {
    if (typeof cfg.maxBackoffMs !== 'number' || cfg.maxBackoffMs < 0) {
      errors.push({ path: 'maxBackoffMs', message: 'Must be a non-negative number' });
    }
  }

  if ('backoffMultiplier' in cfg) {
    if (typeof cfg.backoffMultiplier !== 'number' || cfg.backoffMultiplier < 1) {
      errors.push({ path: 'backoffMultiplier', message: 'Must be a number >= 1' });
    }
  }

  if ('autoRetryFailed' in cfg && typeof cfg.autoRetryFailed !== 'boolean') {
    errors.push({ path: 'autoRetryFailed', message: 'Must be a boolean' });
  }

  return errors;
}

/**
 * Validate epics config
 */
function validateEpicsConfig(epics: unknown): ConfigError[] {
  const errors: ConfigError[] = [];

  if (typeof epics !== 'object' || epics === null) {
    errors.push({ path: '', message: 'Must be an object' });
    return errors;
  }

  const cfg = epics as Record<string, unknown>;

  if ('autoCreateWorktrees' in cfg && typeof cfg.autoCreateWorktrees !== 'boolean') {
    errors.push({ path: 'autoCreateWorktrees', message: 'Must be a boolean' });
  }

  if ('maxWorktreesPerEpic' in cfg) {
    if (typeof cfg.maxWorktreesPerEpic !== 'number' || cfg.maxWorktreesPerEpic < 1 || !Number.isInteger(cfg.maxWorktreesPerEpic)) {
      errors.push({ path: 'maxWorktreesPerEpic', message: 'Must be a positive integer' });
    }
  }

  if ('cleanupOnMerge' in cfg && typeof cfg.cleanupOnMerge !== 'boolean') {
    errors.push({ path: 'cleanupOnMerge', message: 'Must be a boolean' });
  }

  return errors;
}

/**
 * Validate UI config
 */
function validateUiConfig(ui: unknown): ConfigError[] {
  const errors: ConfigError[] = [];

  if (typeof ui !== 'object' || ui === null) {
    errors.push({ path: '', message: 'Must be an object' });
    return errors;
  }

  const cfg = ui as Record<string, unknown>;

  if ('defaultView' in cfg && typeof cfg.defaultView !== 'string') {
    errors.push({ path: 'defaultView', message: 'Must be a string' });
  }

  if ('refreshInterval' in cfg) {
    if (typeof cfg.refreshInterval !== 'number' || cfg.refreshInterval < 0) {
      errors.push({ path: 'refreshInterval', message: 'Must be a non-negative number' });
    }
  }

  if ('showCostInStatusBar' in cfg && typeof cfg.showCostInStatusBar !== 'boolean') {
    errors.push({ path: 'showCostInStatusBar', message: 'Must be a boolean' });
  }

  return errors;
}

/**
 * Get environment variable overrides
 * ORCH_MAX_AGENTS, ORCH_LOG_LEVEL, ORCH_AGENT_MODEL, ORCH_PLAN_FILE
 * ORCH_AUTOMATION_TICKET_PROGRESSION, ORCH_AUTOMATION_REVIEW_MODE, ORCH_AUTOMATION_QA_MODE
 * ORCH_COST_LIMIT_PER_TICKET, ORCH_COST_LIMIT_PER_SESSION, ORCH_COST_LIMIT_ACTION
 * ORCH_ERROR_RECOVERY_MAX_RETRIES, ORCH_ERROR_RECOVERY_INITIAL_BACKOFF_MS,
 * ORCH_ERROR_RECOVERY_MAX_BACKOFF_MS, ORCH_ERROR_RECOVERY_BACKOFF_MULTIPLIER, ORCH_ERROR_RECOVERY_AUTO_RETRY
 */
export function getEnvOverrides(): Partial<OrchConfig> {
  const overrides: Partial<OrchConfig> = {};

  // Core settings
  if (process.env.ORCH_MAX_AGENTS) {
    const value = parseInt(process.env.ORCH_MAX_AGENTS, 10);
    if (!isNaN(value) && value >= 1) {
      overrides.maxAgents = value;
    }
  }

  if (process.env.ORCH_LOG_LEVEL) {
    const level = process.env.ORCH_LOG_LEVEL.toLowerCase();
    if (VALID_LOG_LEVELS.includes(level as typeof VALID_LOG_LEVELS[number])) {
      overrides.logLevel = level as OrchConfig['logLevel'];
    }
  }

  if (process.env.ORCH_AGENT_MODEL) {
    overrides.agentModel = process.env.ORCH_AGENT_MODEL;
  }

  if (process.env.ORCH_PLAN_FILE) {
    overrides.planFile = process.env.ORCH_PLAN_FILE;
  }

  // Automation settings
  const automationOverrides = getAutomationEnvOverrides();
  if (Object.keys(automationOverrides).length > 0) {
    overrides.automation = automationOverrides as AutomationConfig;
  }

  // Cost limit settings
  const costLimitOverrides = getCostLimitEnvOverrides();
  if (Object.keys(costLimitOverrides).length > 0) {
    overrides.costLimit = costLimitOverrides as CostLimitConfig;
  }

  // Error recovery settings
  const errorRecoveryOverrides = getErrorRecoveryEnvOverrides();
  if (Object.keys(errorRecoveryOverrides).length > 0) {
    overrides.errorRecovery = errorRecoveryOverrides as ErrorRecoveryConfig;
  }

  return overrides;
}

/**
 * Get automation config from environment variables
 */
function getAutomationEnvOverrides(): Partial<AutomationConfig> {
  const overrides: Partial<AutomationConfig> = {};

  if (process.env.ORCH_AUTOMATION_TICKET_PROGRESSION) {
    const mode = process.env.ORCH_AUTOMATION_TICKET_PROGRESSION.toLowerCase();
    if (VALID_AUTOMATION_MODES.includes(mode as AutomationMode)) {
      overrides.ticketProgression = mode as AutomationMode;
    }
  }

  if (process.env.ORCH_AUTOMATION_REVIEW_MODE) {
    const mode = process.env.ORCH_AUTOMATION_REVIEW_MODE.toLowerCase();
    if (VALID_AUTOMATION_MODES.includes(mode as AutomationMode)) {
      overrides.review = { mode: mode as AutomationMode };
    }
  }

  if (process.env.ORCH_AUTOMATION_QA_MODE) {
    const mode = process.env.ORCH_AUTOMATION_QA_MODE.toLowerCase();
    if (VALID_AUTOMATION_MODES.includes(mode as AutomationMode)) {
      overrides.qa = { mode: mode as AutomationMode };
    }
  }

  return overrides;
}

/**
 * Get cost limit config from environment variables
 */
function getCostLimitEnvOverrides(): Partial<CostLimitConfig> {
  const overrides: Partial<CostLimitConfig> = {};

  if (process.env.ORCH_COST_LIMIT_PER_TICKET) {
    const value = parseFloat(process.env.ORCH_COST_LIMIT_PER_TICKET);
    if (!isNaN(value) && value >= 0) {
      overrides.perTicket = value;
    }
  }

  if (process.env.ORCH_COST_LIMIT_PER_SESSION) {
    const value = parseFloat(process.env.ORCH_COST_LIMIT_PER_SESSION);
    if (!isNaN(value) && value >= 0) {
      overrides.perSession = value;
    }
  }

  if (process.env.ORCH_COST_LIMIT_ACTION) {
    const action = process.env.ORCH_COST_LIMIT_ACTION.toLowerCase();
    if (VALID_COST_ACTIONS.includes(action as typeof VALID_COST_ACTIONS[number])) {
      overrides.action = action as CostLimitConfig['action'];
    }
  }

  return overrides;
}

/**
 * Get error recovery config from environment variables
 */
function getErrorRecoveryEnvOverrides(): Partial<ErrorRecoveryConfig> {
  const overrides: Partial<ErrorRecoveryConfig> = {};

  if (process.env.ORCH_ERROR_RECOVERY_MAX_RETRIES) {
    const value = parseInt(process.env.ORCH_ERROR_RECOVERY_MAX_RETRIES, 10);
    if (!isNaN(value) && value >= 0) {
      overrides.maxRetries = value;
    }
  }

  if (process.env.ORCH_ERROR_RECOVERY_INITIAL_BACKOFF_MS) {
    const value = parseInt(process.env.ORCH_ERROR_RECOVERY_INITIAL_BACKOFF_MS, 10);
    if (!isNaN(value) && value >= 0) {
      overrides.initialBackoffMs = value;
    }
  }

  if (process.env.ORCH_ERROR_RECOVERY_MAX_BACKOFF_MS) {
    const value = parseInt(process.env.ORCH_ERROR_RECOVERY_MAX_BACKOFF_MS, 10);
    if (!isNaN(value) && value >= 0) {
      overrides.maxBackoffMs = value;
    }
  }

  if (process.env.ORCH_ERROR_RECOVERY_BACKOFF_MULTIPLIER) {
    const value = parseFloat(process.env.ORCH_ERROR_RECOVERY_BACKOFF_MULTIPLIER);
    if (!isNaN(value) && value >= 1) {
      overrides.backoffMultiplier = value;
    }
  }

  if (process.env.ORCH_ERROR_RECOVERY_AUTO_RETRY) {
    const value = process.env.ORCH_ERROR_RECOVERY_AUTO_RETRY.toLowerCase();
    overrides.autoRetryFailed = value === 'true' || value === '1';
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
  let result = deepClone(base);

  for (const override of overrides) {
    result = deepMerge(result, override) as OrchConfig;
  }

  return result;
}

/**
 * Deep clone an object
 */
function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => deepClone(item)) as unknown as T;
  }

  const cloned = {} as T;
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }
  return cloned;
}

/**
 * Deep merge two objects
 */
function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key];
      const targetValue = result[key];

      if (sourceValue === undefined) {
        continue;
      }

      if (
        sourceValue !== null &&
        typeof sourceValue === 'object' &&
        !Array.isArray(sourceValue) &&
        targetValue !== null &&
        typeof targetValue === 'object' &&
        !Array.isArray(targetValue)
      ) {
        (result as Record<string, unknown>)[key] = deepMerge(
          targetValue as object,
          sourceValue as Partial<typeof targetValue>
        );
      } else {
        (result as Record<string, unknown>)[key] = sourceValue;
      }
    }
  }

  return result;
}

/**
 * Watch config file for changes (hot reload)
 * Returns an unwatch function
 */
export function watchConfig(
  projectPath: string,
  onChange: (config: OrchConfig) => void
): () => void {
  const watchers: FSWatcher[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const handleChange = async () => {
    // Debounce to avoid multiple rapid reloads
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(async () => {
      try {
        const result = await loadConfigWithDetails(projectPath);
        if (result.errors.length === 0) {
          onChange(result.config);
        }
        // On error, we silently keep the old config
      } catch {
        // Ignore errors during hot reload
      }
    }, 100);
  };

  // Watch all possible config file locations
  for (const fileName of CONFIG_FILES) {
    const filePath = join(projectPath, fileName);
    if (existsSync(filePath)) {
      try {
        const watcher = watch(filePath, { persistent: false }, (eventType) => {
          if (eventType === 'change') {
            handleChange();
          }
        });
        watchers.push(watcher);
      } catch {
        // File might not be watchable, ignore
      }
    }
  }

  // Return unwatch function
  return () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    for (const watcher of watchers) {
      watcher.close();
    }
  };
}

/**
 * Get default configuration
 */
export function getDefaultConfig(): OrchConfig {
  return deepClone(DEFAULT_CONFIG);
}
