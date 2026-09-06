import { TeamJulesWorker, type TaskLease } from "./worker";

export interface TaskState {
  status: "pending" | "running" | "completed" | "failed";
  pigeonInviteUrl?: string;
  worktreePath?: string;
}

/**
 * TaskDispatcher coordinates the TeamJules swarm on a single node.
 * It manages the lifecycle of agent leases and retains their live GitPigeon 
 * capabilities for the server to expose to the OpenCode UI.
 */
export class TaskDispatcher {
  private worker: TeamJulesWorker;
  private tasks: Map<string, TaskState> = new Map();

  constructor(workspaceRoot: string) {
    this.worker = new TeamJulesWorker(workspaceRoot);
  }

  /**
   * Dispatches a new task lease to the worker and captures the mesh sync URL.
   */
  async dispatchTask(lease: TaskLease): Promise<void> {
    this.tasks.set(lease.taskId, { status: "pending" });

    try {
      // 1. Check out worktree and start GitPigeon
      const { worktreePath, pigeonInviteUrl } = await this.worker.initializeTaskWorkspace(lease);
      
      // 2. Persist the secure capability URL in state
      this.tasks.set(lease.taskId, {
        status: "running",
        worktreePath,
        pigeonInviteUrl,
      });

      console.log(`[Dispatcher] Task ${lease.taskId} is now running. Mesh URL securely stored.`);

      // TODO: Hand off the active worktreePath to the LLM agent session here...
      
    } catch (e) {
      console.error(`[Dispatcher] Task ${lease.taskId} failed to start:`, e);
      this.tasks.set(lease.taskId, { status: "failed" });
    }
  }

  /**
   * Retrieves the current state of a task, including its secure GitPigeon capability.
   */
  getTaskState(taskId: string): TaskState | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Tears down the task and stops the GitPigeon mesh sync.
   */
  async completeTask(lease: TaskLease): Promise<void> {
    const state = this.tasks.get(lease.taskId);
    if (state?.worktreePath) {
      await this.worker.cleanupTaskWorkspace(lease, state.worktreePath);
    }
    this.tasks.set(lease.taskId, { status: "completed" });
  }
}
