/**
 * Epic Manager
 *
 * Manages epic directories and git worktrees for parallel agent work.
 *
 * Implements: T031, T032, T033
 */

import type { Epic, Worktree, Ticket, BaseEvent } from './types';
import { getEventBus } from './events';
import { join, resolve } from 'path';
import { existsSync } from 'fs';

export interface WorktreeAllocation {
  worktreePath: string;
  branch: string;
  isNew: boolean;
}

export interface EpicWorktreeCreatedEvent extends BaseEvent {
  type: 'epic:worktree-created';
  epicName: string;
  worktreePath: string;
  agentId: string;
  ticketId: string;
  branch: string;
}

export interface EpicWorktreeMergedEvent extends BaseEvent {
  type: 'epic:worktree-merged';
  epicName: string;
  worktreePath: string;
  ticketId: string;
  branch: string;
}

export interface EpicConflictEvent extends BaseEvent {
  type: 'epic:conflict';
  epicName: string;
  worktreePath: string;
  ticketId: string;
  conflictFiles: string[];
}

export class EpicManager {
  private projectRoot: string;
  private epics: Map<string, Epic> = new Map();
  private worktrees: Map<string, Worktree> = new Map();
  private epicAgentCounts: Map<string, number> = new Map();
  private maxWorktreesPerEpic: number;
  private autoCreateWorktrees: boolean;

  constructor(
    projectRoot: string,
    options?: {
      maxWorktreesPerEpic?: number;
      autoCreateWorktrees?: boolean;
    }
  ) {
    this.projectRoot = projectRoot;
    this.maxWorktreesPerEpic = options?.maxWorktreesPerEpic ?? 3;
    this.autoCreateWorktrees = options?.autoCreateWorktrees ?? true;
  }

  /**
   * Discover unique epics from tickets
   */
  discoverEpics(tickets: Ticket[]): Epic[] {
    const epicNames = new Set<string>();
    for (const ticket of tickets) {
      if (ticket.epic) {
        epicNames.add(ticket.epic);
      }
    }

    const epics: Epic[] = [];
    for (const name of epicNames) {
      // Default path is the epic name as a subdirectory
      // This can be overridden when initializing with explicit Epic objects
      epics.push({
        name,
        path: name,
      });
    }

    return epics;
  }

  /**
   * Validate that epic directories exist
   */
  async validateEpicDirectories(epics: Epic[]): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    for (const epic of epics) {
      const fullPath = resolve(this.projectRoot, epic.path);
      if (!existsSync(fullPath)) {
        errors.push(`Epic directory not found: ${epic.name} (${fullPath})`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Initialize with epics from plan
   */
  async initialize(epics: Epic[]): Promise<void> {
    // Store epics
    this.epics.clear();
    for (const epic of epics) {
      this.epics.set(epic.name, epic);
      this.epicAgentCounts.set(epic.name, 0);
    }

    // Validate paths exist
    const validation = await this.validateEpicDirectories(epics);
    if (!validation.valid) {
      // Log warnings but don't throw - epics may be created during work
      for (const error of validation.errors) {
        console.warn(`Warning: ${error}`);
      }
    }

    // Check for existing worktrees
    const existingWorktrees = await listWorktrees(this.projectRoot);
    // Parse existing worktrees and track them if they match our pattern
    for (const wtPath of existingWorktrees) {
      // Skip the main worktree
      if (wtPath === this.projectRoot) continue;

      // Check if it matches our naming pattern: {epic}-worktree-{agent-id}
      const pathParts = wtPath.split('/');
      const dirName = pathParts[pathParts.length - 1];
      const match = dirName.match(/^(.+)-worktree-(.+)$/);
      if (match) {
        const [, epicName, agentId] = match;
        if (this.epics.has(epicName)) {
          // Track this worktree (we don't have ticket info from just the filesystem)
          const count = this.epicAgentCounts.get(epicName) || 0;
          this.epicAgentCounts.set(epicName, count + 1);
        }
      }
    }
  }

  /**
   * Get epic by name
   */
  getEpic(name: string): Epic | undefined {
    return this.epics.get(name);
  }

  /**
   * Get all epics
   */
  getAllEpics(): Epic[] {
    return Array.from(this.epics.values());
  }

  /**
   * Allocate a working directory for an agent on a ticket
   * Creates worktree if needed
   */
  async allocateWorktree(
    ticket: Ticket,
    agentId: string
  ): Promise<WorktreeAllocation> {
    const epicName = ticket.epic;

    // If no epic specified, use project root
    if (!epicName) {
      return {
        worktreePath: this.projectRoot,
        branch: 'main',
        isNew: false,
      };
    }

    const epic = this.epics.get(epicName);
    if (!epic) {
      throw new Error(`Epic not found: ${epicName}`);
    }

    const currentCount = this.epicAgentCounts.get(epicName) || 0;

    // If no agents in this epic yet, use the main epic directory
    if (currentCount === 0) {
      this.epicAgentCounts.set(epicName, 1);

      // Track this allocation (no separate worktree, using main dir)
      const worktree: Worktree = {
        path: resolve(this.projectRoot, epic.path),
        epicName,
        agentId,
        ticketId: ticket.id,
        branch: `ticket/${ticket.id}`,
        createdAt: new Date(),
      };
      this.worktrees.set(agentId, worktree);

      return {
        worktreePath: resolve(this.projectRoot, epic.path),
        branch: `ticket/${ticket.id}`,
        isNew: false,
      };
    }

    // If we have agents and auto-create is disabled, throw
    if (!this.autoCreateWorktrees) {
      throw new Error(`Epic ${epicName} already has an active agent and worktree auto-creation is disabled`);
    }

    // Check worktree limit
    if (currentCount >= this.maxWorktreesPerEpic) {
      throw new Error(`Epic ${epicName} has reached maximum worktrees (${this.maxWorktreesPerEpic})`);
    }

    // Create a new worktree
    const worktreePath = resolve(this.projectRoot, `${epicName}-worktree-${agentId}`);
    const branch = `ticket/${ticket.id}`;

    await createWorktree(this.projectRoot, worktreePath, branch);

    // Track the new worktree
    this.epicAgentCounts.set(epicName, currentCount + 1);
    const worktree: Worktree = {
      path: worktreePath,
      epicName,
      agentId,
      ticketId: ticket.id,
      branch,
      createdAt: new Date(),
    };
    this.worktrees.set(agentId, worktree);

    // Emit event
    const eventBus = getEventBus();
    eventBus.publish({
      type: 'epic:worktree-created',
      timestamp: new Date(),
      epicName,
      worktreePath,
      agentId,
      ticketId: ticket.id,
      branch,
    } as EpicWorktreeCreatedEvent);

    return {
      worktreePath,
      branch,
      isNew: true,
    };
  }

  /**
   * Release a worktree after agent completes
   */
  async releaseWorktree(agentId: string): Promise<void> {
    const worktree = this.worktrees.get(agentId);
    if (!worktree) {
      // Agent may not have had a worktree (e.g., worked in project root)
      return;
    }

    // Decrement epic agent count
    const currentCount = this.epicAgentCounts.get(worktree.epicName) || 0;
    if (currentCount > 0) {
      this.epicAgentCounts.set(worktree.epicName, currentCount - 1);
    }

    // Remove from active worktrees
    this.worktrees.delete(agentId);

    // Note: We don't delete the worktree here - that's handled by cleanupWorktree
    // or mergeWorktree which are part of T032
  }

  /**
   * Find worktree by path
   */
  getWorktreeByPath(worktreePath: string): Worktree | undefined {
    return Array.from(this.worktrees.values())
      .find(w => w.path === worktreePath);
  }

  /**
   * Find worktree by ticket ID
   */
  getWorktreeByTicketId(ticketId: string): Worktree | undefined {
    return Array.from(this.worktrees.values())
      .find(w => w.ticketId === ticketId);
  }

  /**
   * Merge a completed worktree back to epic main branch
   */
  async mergeWorktree(worktreePath: string, targetBranch: string = 'main'): Promise<MergeResult> {
    // Get worktree info from tracking
    const worktree = this.getWorktreeByPath(worktreePath);
    if (!worktree) {
      throw new Error(`Worktree not tracked: ${worktreePath}`);
    }

    const eventBus = getEventBus();

    // Attempt the merge
    const result = await mergeBranch(this.projectRoot, worktree.branch, targetBranch);

    if (result.hasConflicts) {
      // Emit conflict event
      eventBus.publish({
        type: 'epic:conflict',
        timestamp: new Date(),
        epicName: worktree.epicName,
        worktreePath: worktree.path,
        ticketId: worktree.ticketId,
        conflictFiles: result.conflictFiles || [],
      } as EpicConflictEvent);
    } else if (result.success) {
      // Emit success event
      eventBus.publish({
        type: 'epic:worktree-merged',
        timestamp: new Date(),
        epicName: worktree.epicName,
        worktreePath: worktree.path,
        ticketId: worktree.ticketId,
        branch: worktree.branch,
      } as EpicWorktreeMergedEvent);
    }

    return result;
  }

  /**
   * Clean up a worktree
   */
  async cleanupWorktree(worktreePath: string): Promise<void> {
    // Get worktree info for updating tracking
    const worktree = this.getWorktreeByPath(worktreePath);

    // Remove the worktree from git
    await removeWorktree(worktreePath);

    // Update tracking if we found the worktree
    if (worktree) {
      // Decrement epic agent count
      const currentCount = this.epicAgentCounts.get(worktree.epicName) || 0;
      if (currentCount > 0) {
        this.epicAgentCounts.set(worktree.epicName, currentCount - 1);
      }

      // Remove from worktrees tracking
      this.worktrees.delete(worktree.agentId);
    }
  }

  /**
   * Clean up all stale worktrees
   * Removes worktrees older than the threshold that have no active agents
   */
  async cleanupStaleWorktrees(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<string[]> {
    const now = new Date();
    const cleaned: string[] = [];

    // Get all worktrees tracked by us
    const trackedWorktrees = Array.from(this.worktrees.values());

    for (const worktree of trackedWorktrees) {
      const age = now.getTime() - worktree.createdAt.getTime();

      // Only clean up worktrees that:
      // 1. Are older than the threshold
      // 2. Are actual worktrees (not the main epic directory)
      if (age > maxAgeMs && worktree.path !== resolve(this.projectRoot, this.epics.get(worktree.epicName)?.path || '')) {
        try {
          await this.cleanupWorktree(worktree.path);
          cleaned.push(worktree.path);
        } catch (error) {
          // Log error but continue with other worktrees
          console.warn(`Failed to clean up stale worktree ${worktree.path}: ${error}`);
        }
      }
    }

    return cleaned;
  }

  /**
   * Get active worktrees for an epic
   */
  getWorktreesForEpic(epicName: string): Worktree[] {
    return Array.from(this.worktrees.values())
      .filter(w => w.epicName === epicName);
  }

  /**
   * Get worktree for an agent
   */
  getWorktreeForAgent(agentId: string): Worktree | undefined {
    return Array.from(this.worktrees.values())
      .find(w => w.agentId === agentId);
  }

  /**
   * Check if epic can accept more agents
   */
  canAcceptAgent(epicName: string): boolean {
    const count = this.epicAgentCounts.get(epicName) || 0;
    const epic = this.epics.get(epicName);
    if (!epic) return false;

    // If at main dir, can create worktree
    if (count === 0) return true;

    // If auto-create disabled, can't add more
    if (!this.autoCreateWorktrees) return count === 0;

    // Check worktree limit
    return count < this.maxWorktreesPerEpic;
  }

  /**
   * Retry merge after manual conflict resolution
   * This is called when user presses 'm' key in UI after resolving conflicts
   */
  async retryMerge(worktreePath: string, targetBranch: string = 'main'): Promise<MergeResult> {
    const worktree = this.getWorktreeByPath(worktreePath);
    if (!worktree) {
      throw new Error(`Worktree not tracked: ${worktreePath}`);
    }

    const eventBus = getEventBus();

    // Check if merge is in progress and conflicts are resolved
    const result = await completeMergeAfterConflictResolution(this.projectRoot);

    if (result.success) {
      // Emit success event
      eventBus.publish({
        type: 'epic:worktree-merged',
        timestamp: new Date(),
        epicName: worktree.epicName,
        worktreePath: worktree.path,
        ticketId: worktree.ticketId,
        branch: worktree.branch,
      } as EpicWorktreeMergedEvent);
    } else if (result.hasConflicts) {
      // Still has conflicts
      eventBus.publish({
        type: 'epic:conflict',
        timestamp: new Date(),
        epicName: worktree.epicName,
        worktreePath: worktree.path,
        ticketId: worktree.ticketId,
        conflictFiles: result.conflictFiles || [],
      } as EpicConflictEvent);
    }

    return result;
  }
}

// =============================================================================
// Git operations
// =============================================================================

export interface MergeResult {
  success: boolean;
  hasConflicts: boolean;
  conflictFiles?: string[];
  mergedCommit?: string;
}

/**
 * Create a new git worktree
 */
export async function createWorktree(
  repoPath: string,
  worktreePath: string,
  branch: string
): Promise<void> {
  const proc = Bun.spawn(['git', 'worktree', 'add', '-b', branch, worktreePath], {
    cwd: repoPath,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Failed to create worktree: ${stderr}`);
  }
}

/**
 * Remove a git worktree
 * The worktreePath must be the absolute path to the worktree.
 * Git worktree remove needs to run from a valid git repo directory.
 */
export async function removeWorktree(worktreePath: string, force: boolean = false): Promise<void> {
  const args = ['worktree', 'remove'];
  if (force) {
    args.push('--force');
  }
  args.push(worktreePath);

  // Run from the worktree path itself (git will find the main repo)
  const proc = Bun.spawn(['git', ...args], {
    cwd: worktreePath,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Failed to remove worktree: ${stderr}`);
  }
}

/**
 * List all worktrees in a repo
 */
export async function listWorktrees(repoPath: string): Promise<string[]> {
  const proc = Bun.spawn(['git', 'worktree', 'list', '--porcelain'], {
    cwd: repoPath,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    // Not a git repo or other git error - return empty array
    // This allows ORCH to work in non-git directories
    return [];
  }

  const stdout = await new Response(proc.stdout).text();

  // Parse porcelain output - each worktree starts with "worktree <path>"
  const worktrees: string[] = [];
  const lines = stdout.split('\n');

  for (const line of lines) {
    if (line.startsWith('worktree ')) {
      worktrees.push(line.substring('worktree '.length));
    }
  }

  return worktrees;
}

/**
 * Get current branch name
 */
export async function getCurrentBranch(repoPath: string): Promise<string> {
  const proc = Bun.spawn(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: repoPath,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error('Failed to get current branch');
  }

  const stdout = await new Response(proc.stdout).text();
  return stdout.trim();
}

/**
 * Get list of conflicted files after a merge
 */
async function getConflictedFiles(repoPath: string): Promise<string[]> {
  const proc = Bun.spawn(['git', 'diff', '--name-only', '--diff-filter=U'], {
    cwd: repoPath,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    return [];
  }

  const stdout = await new Response(proc.stdout).text();
  return stdout.trim().split('\n').filter(Boolean);
}

/**
 * Abort a merge in progress
 */
export async function abortMerge(repoPath: string): Promise<void> {
  const proc = Bun.spawn(['git', 'merge', '--abort'], {
    cwd: repoPath,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  await proc.exited;
  // We don't throw on error since the merge may not be in progress
}

/**
 * Check if there's a merge in progress
 */
export async function isMergeInProgress(repoPath: string): Promise<boolean> {
  const mergeHeadPath = join(repoPath, '.git', 'MERGE_HEAD');
  return existsSync(mergeHeadPath);
}

/**
 * Complete a merge after conflicts have been manually resolved
 * User must have staged all resolved files with `git add`
 */
export async function completeMergeAfterConflictResolution(repoPath: string): Promise<MergeResult> {
  // Check if there's a merge in progress
  if (!(await isMergeInProgress(repoPath))) {
    throw new Error('No merge in progress');
  }

  // Check for remaining unresolved conflicts
  const conflictFiles = await getConflictedFiles(repoPath);
  if (conflictFiles.length > 0) {
    return {
      success: false,
      hasConflicts: true,
      conflictFiles,
    };
  }

  // All conflicts resolved, complete the merge
  const commitProc = Bun.spawn(['git', 'commit', '--no-edit'], {
    cwd: repoPath,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const exitCode = await commitProc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(commitProc.stderr).text();
    throw new Error(`Failed to complete merge: ${stderr}`);
  }

  // Get the commit hash
  const revProc = Bun.spawn(['git', 'rev-parse', 'HEAD'], {
    cwd: repoPath,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  await revProc.exited;
  const mergedCommit = (await new Response(revProc.stdout).text()).trim();

  return {
    success: true,
    hasConflicts: false,
    mergedCommit,
  };
}

/**
 * Merge a branch into a target branch
 */
export async function mergeBranch(
  repoPath: string,
  branchName: string,
  targetBranch: string = 'main'
): Promise<MergeResult> {
  // Store original branch to restore if needed
  const originalBranch = await getCurrentBranch(repoPath);

  try {
    // Checkout target branch
    const checkoutProc = Bun.spawn(['git', 'checkout', targetBranch], {
      cwd: repoPath,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const checkoutExitCode = await checkoutProc.exited;
    if (checkoutExitCode !== 0) {
      const stderr = await new Response(checkoutProc.stderr).text();
      throw new Error(`Failed to checkout ${targetBranch}: ${stderr}`);
    }

    // Attempt merge
    const mergeProc = Bun.spawn(['git', 'merge', '--no-edit', branchName], {
      cwd: repoPath,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const mergeExitCode = await mergeProc.exited;

    if (mergeExitCode === 0) {
      // Get the merged commit hash
      const revProc = Bun.spawn(['git', 'rev-parse', 'HEAD'], {
        cwd: repoPath,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      await revProc.exited;
      const mergedCommit = (await new Response(revProc.stdout).text()).trim();

      return {
        success: true,
        hasConflicts: false,
        mergedCommit,
      };
    }

    // Check if there are conflicts
    const conflictFiles = await getConflictedFiles(repoPath);

    if (conflictFiles.length > 0) {
      // Leave merge in progress for manual resolution
      return {
        success: false,
        hasConflicts: true,
        conflictFiles,
      };
    }

    // Some other merge error
    const stderr = await new Response(mergeProc.stderr).text();
    throw new Error(`Merge failed: ${stderr}`);

  } catch (error) {
    // On error (except conflicts), try to restore original state
    if (error instanceof Error && !error.message.includes('conflict')) {
      // Try to abort merge and checkout original branch
      await abortMerge(repoPath);
      const restoreProc = Bun.spawn(['git', 'checkout', originalBranch], {
        cwd: repoPath,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      await restoreProc.exited;
    }
    throw error;
  }
}

/**
 * Get git diff for a ticket branch
 *
 * Returns the diff between the base branch and HEAD.
 * Tries multiple strategies to get the most relevant diff:
 * 1. Diff against base branch (main by default)
 * 2. Diff of uncommitted changes
 * 3. Diff of staged changes
 * 4. Show the last commit's diff
 */
export async function getTicketDiff(
  worktreePath: string,
  baseBranch?: string
): Promise<string> {
  const base = baseBranch || 'main';

  // First, try to get diff against base branch
  let proc = Bun.spawn(['git', 'diff', `${base}...HEAD`], {
    cwd: worktreePath,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  let exitCode = await proc.exited;

  if (exitCode === 0) {
    const stdout = await new Response(proc.stdout).text();
    if (stdout.trim()) {
      return stdout;
    }
  }

  // If no diff against base or base doesn't exist, try diff of staged and unstaged changes
  proc = Bun.spawn(['git', 'diff', 'HEAD'], {
    cwd: worktreePath,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  exitCode = await proc.exited;

  if (exitCode === 0) {
    const stdout = await new Response(proc.stdout).text();
    if (stdout.trim()) {
      return stdout;
    }
  }

  // If still no diff, try diff of staged changes only
  proc = Bun.spawn(['git', 'diff', '--cached'], {
    cwd: worktreePath,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  exitCode = await proc.exited;

  if (exitCode === 0) {
    const stdout = await new Response(proc.stdout).text();
    if (stdout.trim()) {
      return stdout;
    }
  }

  // Last resort: show the last commit's diff
  proc = Bun.spawn(['git', 'show', '--format=', 'HEAD'], {
    cwd: worktreePath,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  exitCode = await proc.exited;

  if (exitCode === 0) {
    return await new Response(proc.stdout).text();
  }

  // No diff available
  return '';
}
