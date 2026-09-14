export type StageState = "SPEC" | "PLAN" | "BUILD" | "GATE" | "REVIEW" | "IDLE" | "BLOCKED";
export type StageSeverity = "cyan" | "mid" | "green" | "amber" | "bright" | "dim" | "red";
export interface StageInput {
  archived?: boolean;
  deleted?: boolean;
  permissionPending?: boolean;
  busy?: boolean;
  error?: boolean;
  retry?: boolean;
  toolRunning?: boolean;
  questionPending?: boolean;
  diffNonEmpty?: boolean;
  idle?: boolean;
  todosProposed?: boolean;
  todosActive?: boolean;
}
export interface StageResult {
  state: StageState;
  severity: StageSeverity;
}
export function mapStage(input: StageInput): StageResult {
  const v = (k: keyof StageInput): boolean => input[k] === true;
  if (v("archived") || v("deleted")) return { state: "IDLE", severity: "dim" };
  if (v("permissionPending") && v("busy")) return { state: "BLOCKED", severity: "amber" };
  if (v("error") || v("retry")) return { state: "BLOCKED", severity: "red" };
  if (v("permissionPending")) return { state: "BLOCKED", severity: "amber" };
  if (v("toolRunning") || v("busy")) return { state: "BUILD", severity: "green" };
  if (v("questionPending")) return { state: "GATE", severity: "amber" };
  if (v("diffNonEmpty") && v("idle")) return { state: "REVIEW", severity: "bright" };
  if (v("todosActive")) return { state: "BUILD", severity: "green" };
  if (v("todosProposed")) return { state: "PLAN", severity: "mid" };
  if (v("busy")) return { state: "BUILD", severity: "green" };
  if (v("idle")) return { state: "IDLE", severity: "dim" };
  return { state: "SPEC", severity: "cyan" };
}
