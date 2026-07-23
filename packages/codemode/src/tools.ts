import type { Definition } from "./tool.js"

export type Tools<R = never> = {
  readonly [name: string]: Definition<R> | Tools<R>
}
