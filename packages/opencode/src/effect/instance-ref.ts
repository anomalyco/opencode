import { Context } from "effect"
import type { InstanceContext } from "@/project/instance-context"
import type { WorkspaceV2 } from "@opencode-ai/core/workspace"

export const InstanceRef = Context.Reference<InstanceContext | undefined>("~opencode/InstanceRef", {
  defaultValue: () => undefined,
})

export const WorkspaceRef = Context.Reference<WorkspaceV2.ID | undefined>("~opencode/WorkspaceRef", {
  defaultValue: () => undefined,
})
