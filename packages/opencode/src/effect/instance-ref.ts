import { Context } from "effect"
import type { InstanceContext } from "@/project/instance-context"

export const InstanceRef = Context.Reference<InstanceContext | undefined>("~opencode/InstanceRef", {
  defaultValue: () => undefined,
})
