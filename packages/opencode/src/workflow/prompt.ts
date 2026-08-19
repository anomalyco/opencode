import ARCHITECT_PLANNING_V1 from "./prompt/architect-planning-v1.txt"
import ARCHITECT_AUDIT_V1 from "./prompt/architect-audit-v1.txt"
import CODER_TASK_V1 from "./prompt/coder-task-v1.txt"
import CODER_REMEDIATION_V1 from "./prompt/coder-remediation-v1.txt"

export const WorkflowPrompt = {
  architectPlanning: {
    version: "architect-planning-v1",
    text: ARCHITECT_PLANNING_V1,
  },
  architectAudit: {
    version: "architect-audit-v1",
    text: ARCHITECT_AUDIT_V1,
  },
  coderTask: {
    version: "coder-task-v1",
    text: CODER_TASK_V1,
  },
  coderRemediation: {
    version: "coder-remediation-v1",
    text: CODER_REMEDIATION_V1,
  },
} as const

