import { ServiceMap } from "effect"
import type { InstanceContext } from "@/project/instance"

export const InstanceRef = ServiceMap.Reference<InstanceContext | undefined>("~opencode/InstanceRef", {
  defaultValue: () => undefined,
})
