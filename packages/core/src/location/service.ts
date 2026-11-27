export * as Location from "./service.js"

// The service tag lives apart from the layer so Bus can read the ambient
// Location without closing the cycle bus -> location -> project -> bus.
import { Context } from "effect"
import { Info, Ref, response } from "@opencode/schema/location"
import type { Project } from "../project.js"

export { Info, Ref, response }

export interface Interface extends Info {
  readonly vcs?: Project.Vcs
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Location") {}
