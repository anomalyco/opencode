import { spawn } from "node:child_process";
import { join } from "node:path";
import * as fs from "node:fs/promises";

export interface TaskLease {
  taskId: string;
  workspaceId: string;
  repositoryUrl: string;
  branch: string;
  pigeonCapability?: string; // The pre-assigned GitPigeon mesh for this workspace
}

export class TeamJulesWorker {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Initializes a task workspace by cloning the target repository,
   * checking out the task branch, and initializing the GitPigeon mesh sync.
   */
  async initializeTaskWorkspace(lease: TaskLease): Promise<{ worktreePath: string; pigeonInviteUrl: string }> {
    const worktreePath = join(this.workspaceRoot, lease.taskId);

    console.log(`[TeamJules] Initializing workspace for task ${lease.taskId}...`);
    
    // 1. Clone or add worktree for the repository
    await this.exec("git", ["clone", "-b", lease.branch, lease.repositoryUrl, worktreePath]);
    
    // 2. Initialize GitPigeon in the new worktree
    let pigeonInviteUrl = "";
    if (lease.pigeonCapability) {
      console.log(`[TeamJules] Joining assigned GitPigeon mesh for workspace ${lease.workspaceId}...`);
      await this.exec("git", ["pigeon", "init", lease.pigeonCapability, lease.taskId], { cwd: worktreePath });
      pigeonInviteUrl = lease.pigeonCapability;
    } else {
      console.log(`[TeamJules] Starting NEW GitPigeon mesh on ${worktreePath}...`);
      const pigeonOutput = await this.exec("git", ["pigeon", "init"], { cwd: worktreePath });
      pigeonInviteUrl = this.extractInviteUrl(pigeonOutput) || "";
    }

    if (!pigeonInviteUrl) {
      console.warn("[TeamJules] Warning: Could not parse GitPigeon invite URL. Sync may not be active.");
    } else {
      console.log(`[TeamJules] GitPigeon active! Watch live at: ${pigeonInviteUrl}`);
    }

    return {
      worktreePath,
      pigeonInviteUrl: pigeonInviteUrl || "",
    };
  }

  /**
   * Cleans up the task workspace and unwatches the repository from the GitPigeon daemon.
   */
  async cleanupTaskWorkspace(lease: TaskLease, worktreePath: string): Promise<void> {
    console.log(`[TeamJules] Cleaning up workspace for task ${lease.taskId}...`);

    try {
      // 1. Stop GitPigeon mesh sync to free up watcher resources
      await this.exec("git", ["pigeon", "unwatch"], { cwd: worktreePath });
      console.log(`[TeamJules] GitPigeon un-watched repository.`);
    } catch (e) {
      console.error(`[TeamJules] Failed to unwatch repository:`, e);
    }

    // 2. Remove the physical worktree
    await fs.rm(worktreePath, { recursive: true, force: true });
    console.log(`[TeamJules] Removed workspace directory.`);
  }

  private extractInviteUrl(output: string): string | null {
    // Looks for 'gitpigeon://sync/...' in the init output
    const match = output.match(/(gitpigeon:\/\/sync\/[a-zA-Z0-9_-]+#[a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }

  private exec(command: string, args: string[], options?: { cwd?: string }): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { cwd: options?.cwd });
      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => (stdout += data.toString()));
      proc.stderr.on("data", (data) => (stderr += data.toString()));

      proc.on("close", (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`Command failed with code ${code}: ${stderr}`));
      });
    });
  }
}
