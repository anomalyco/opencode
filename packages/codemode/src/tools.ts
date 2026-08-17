import type { Tool } from "./tool.js"

export type Tools<R = never> = {
  readonly [name: string]: Tool<R> | Tools<R>
}
