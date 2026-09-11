import { Context } from "effect"
import type { InstanceContext } from "@/project/instance-context"
import type { WorkspaceV2 } from "@argus-ai/core/workspace"

export const InstanceRef = Context.Reference<InstanceContext | undefined>("~argus/InstanceRef", {
  defaultValue: () => undefined,
})

export const WorkspaceRef = Context.Reference<WorkspaceV2.ID | undefined>("~argus/WorkspaceRef", {
  defaultValue: () => undefined,
})
