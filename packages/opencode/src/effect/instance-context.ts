import { ServiceMap } from "effect"
import type { Project } from "@/project/project"

export declare namespace InstanceContext {
  export interface Shape {
    readonly directory: string
    readonly project: Project.Info
  }
}

export class InstanceContext extends ServiceMap.Service<InstanceContext, InstanceContext.Shape>()(
  "opencode/InstanceContext",
) {}
