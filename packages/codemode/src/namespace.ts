import type { Tools } from "./tools.js"

/** A tool namespace with optional model-visible metadata. */
export type Namespace<R = never> = {
  readonly _tag: "CodeModeNamespace"
  readonly description?: string
  readonly removed?: Readonly<Record<string, string>>
  readonly tools: Tools<R>
}

/** Options for declaring one CodeMode namespace. */
export type Options<R = never> = {
  readonly description?: string
  /**
   * Tools this namespace no longer has, by the dotted name they had under it. A call to one fails with its sentence,
   * which says what to call instead, where an unknown tool would get a guessed suggestion.
   */
  readonly removed?: Readonly<Record<string, string>>
  readonly tools: Tools<R>
}

export const isNamespace = <R = never>(value: Namespace<R> | Tools<R>): value is Namespace<R> =>
  Object.hasOwn(value, "_tag") && value._tag === "CodeModeNamespace"

/** Declares a namespace when descriptions or other namespace metadata are needed. */
export const make = <R = never>(options: Options<R>): Namespace<R> => ({
  _tag: "CodeModeNamespace",
  ...(options.description === undefined ? {} : { description: options.description }),
  ...(options.removed === undefined ? {} : { removed: options.removed }),
  tools: options.tools,
})
