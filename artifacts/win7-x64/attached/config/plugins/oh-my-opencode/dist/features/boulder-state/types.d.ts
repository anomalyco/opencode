/**
 * Boulder State Types
 *
 * Manages the active work plan state for Sisyphus orchestrator.
 * Named after Sisyphus's boulder - the eternal task that must be rolled.
 */
export interface BoulderState {
    /** Absolute path to the active plan file */
    active_plan: string;
    /** ISO timestamp when work started */
    started_at: string;
    /** Session IDs that have worked on this plan */
    session_ids: string[];
    session_origins?: Record<string, "direct" | "appended">;
    /** Plan name derived from filename */
    plan_name: string;
    /** Agent type to use when resuming (e.g., 'atlas') */
    agent?: string;
    /** Absolute path to the git worktree root where work happens */
    worktree_path?: string;
    /** Preferred reusable subagent sessions keyed by current top-level plan task */
    task_sessions?: Record<string, TaskSessionState>;
}
export interface PlanProgress {
    /** Total number of checkboxes */
    total: number;
    /** Number of completed checkboxes */
    completed: number;
    /** Whether all tasks are done */
    isComplete: boolean;
}
export interface TaskSessionState {
    /** Stable identifier for the current top-level plan task (e.g. todo:1 / final-wave:F1) */
    task_key: string;
    /** Original task label from the plan file */
    task_label: string;
    /** Full task title from the plan file */
    task_title: string;
    /** Preferred reusable subagent session */
    session_id: string;
    /** Agent associated with the task session, when known */
    agent?: string;
    /** Category associated with the task session, when known */
    category?: string;
    /** Last update timestamp */
    updated_at: string;
}
export interface TopLevelTaskRef {
    /** Stable identifier for the current top-level plan task */
    key: string;
    /** Task section in the Prometheus plan */
    section: "todo" | "final-wave";
    /** Original label token (e.g. 1 / F1) */
    label: string;
    /** Full task title extracted from the checkbox line */
    title: string;
}
