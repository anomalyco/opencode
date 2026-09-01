import type { Tools } from "./tools.js"

/** A tool namespace with optional model-visible metadata. */
export type Namespace<R = never> = {
  readonly _tag: "CodeModeNamespace"
  readonly description?: string
  readonly tools: Tools<R>
}

/** Options for declaring one CodeMode namespace. */
export type Options<R = never> = {
  readonly description?: string
  readonly tools: Tools<R>
}

export const isNamespace = <R = never>(value: Namespace<R> | Tools<R>): value is Namespace<R> =>
  Object.hasOwn(value, "_tag") && value._tag === "CodeModeNamespace"

/** Declares a namespace when descriptions or other namespace metadata are needed. */
export const make = <R = never>(options: Options<R>): Namespace<R> => ({
  _tag: "CodeModeNamespace",
  ...(options.description === undefined ? {} : { description: options.description }),
  tools: options.tools,
})
