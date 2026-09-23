import type { Namespace } from "./namespace.js"
import type { Tool } from "./tool.js"

export type Tools<R = never> = {
  readonly [name: string]: Tool<R> | Namespace<R> | Tools<R>
}
