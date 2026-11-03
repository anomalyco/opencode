type Json = null | string | boolean | number | ReadonlyArray<Json> | { readonly [key: string]: Json }

export class LuaFault extends Error {
  readonly kind: "ParseError" | "UnsupportedSyntax" | "ExecutionFailure" | "InvalidDataValue"
  readonly location?: { line: number; column: number }
}

export const luaBuiltins: readonly string[]

declare class LuaHostFailure {
  private readonly brand: never
}
export function hostFailure(message: string): LuaHostFailure

/** Inputs must already be inert JSON, never JS proxies. Discard/return the iterator on interruption. */
export function evaluateLua(
  source: string,
  options: { paths: ReadonlyArray<ReadonlyArray<string>>; bindings?: Readonly<Record<string, Json>> },
): Generator<
  { type: "tick" } | { type: "call"; path: string[]; args: (Json | undefined)[]; protected: boolean },
  Json | undefined,
  Json | undefined | LuaHostFailure
>
