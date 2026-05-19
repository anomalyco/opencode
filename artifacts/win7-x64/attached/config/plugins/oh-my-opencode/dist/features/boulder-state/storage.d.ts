/**
 * Boulder State Storage
 *
 * Handles reading/writing boulder.json for active plan tracking.
 */
import type { BoulderState, PlanProgress, TaskSessionState } from "./types";
export declare function getBoulderFilePath(directory: string): string;
export declare function readBoulderState(directory: string): BoulderState | null;
export declare function writeBoulderState(directory: string, state: BoulderState): boolean;
export declare function appendSessionId(directory: string, sessionId: string, origin?: "direct" | "appended"): BoulderState | null;
export declare function clearBoulderState(directory: string): boolean;
export declare function getTaskSessionState(directory: string, taskKey: string): TaskSessionState | null;
export declare function upsertTaskSessionState(directory: string, input: {
    taskKey: string;
    taskLabel: string;
    taskTitle: string;
    sessionId: string;
    agent?: string;
    category?: string;
}): BoulderState | null;
/**
 * Find Prometheus plan files for this project.
 * Prometheus stores plans at: {project}/.sisyphus/plans/{name}.md
 */
export declare function findPrometheusPlans(directory: string): string[];
/**
 * Parse a plan file and count checkbox progress.
 *
 * Only top-level (zero-indent) checkboxes under `## TODOs` and
 * `## Final Verification Wave` sections are counted. The checkbox
 * body must carry a valid task label (`N.` for TODOs, `FN.` for
 * Final Verification Wave). Nested acceptance-criteria checkboxes
 * and checkboxes in other sections are intentionally ignored so
 * that progress tracking stays aligned with `readCurrentTopLevelTask`.
 */
export declare function getPlanProgress(planPath: string): PlanProgress;
/**
 * Extract plan name from file path.
 */
export declare function getPlanName(planPath: string): string;
/**
 * Create a new boulder state for a plan.
 */
export declare function createBoulderState(planPath: string, sessionId: string, agent?: string, worktreePath?: string): BoulderState;
