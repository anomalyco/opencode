import { Context } from "effect"

export * as Instance from "./instance"

export type Ref = {
  readonly directory: string
  readonly workspaceID?: string
}

export class Service extends Context.Service<Service, Ref>()("@opencode/Instance") {}
