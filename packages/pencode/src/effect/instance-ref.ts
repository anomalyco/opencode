import { Context } from "effect"
import type { InstanceContext } from "@/project/instance-context"
import type { WorkspaceV2 } from "@pencode-ai/core/workspace"

export const InstanceRef = Context.Reference<InstanceContext | undefined>("~pencode/InstanceRef", {
  defaultValue: () => undefined,
})

export const WorkspaceRef = Context.Reference<WorkspaceV2.ID | undefined>("~pencode/WorkspaceRef", {
  defaultValue: () => undefined,
})
