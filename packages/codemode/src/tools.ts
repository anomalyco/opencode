import type { Declaration } from "./tool.js"

export type Tools<R = never> = {
  readonly [name: string]: Declaration<R> | Tools<R>
}
