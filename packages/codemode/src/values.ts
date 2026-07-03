// Sandbox value types backed by host primitives. They live in their own module so both the
// interpreter (codemode.ts) and the data boundary (tool-runtime.ts) can reference them without
// a circular import. All four are opaque runtime values inside a program; when a value crosses
// the sandbox boundary (final result, tool arguments, JSON.stringify) they serialize exactly as
// JSON.stringify would: Date -> ISO string (invalid -> null), RegExp/Map/Set -> {}.

import type { Effect, Fiber } from "effect"

/**
 * A first-class promise value produced by an un-awaited tool call (or by
 * `Promise.resolve`/`Promise.reject`). Tool-call promises are eager: the call runs on a fiber
 * forked at call time, and `await` observes that fiber's settlement. Promises are opaque
 * runtime references — `typeof` reports `"object"` (as in real JS), operators reject them, and
 * they cannot cross a data boundary un-awaited (the boundary raises an await-hinting
 * diagnostic instead of serializing `{}`).
 */
export class SandboxPromise {
  /** Set when Promise.race interrupts this promise's in-flight call after another entry wins. */
  interrupted = false
  constructor(
    /** Backing fiber for an eagerly started tool call; undefined for resolve/reject promises. */
    readonly fiber: Fiber.Fiber<unknown, unknown> | undefined,
    /** Immediate settlement for fiberless promises (Promise.resolve / Promise.reject). */
    readonly immediate?: Effect.Effect<unknown, unknown>,
  ) {}
}

/** An immutable instant, backed by an epoch-milliseconds time value (NaN = Invalid Date). */
export class SandboxDate {
  constructor(readonly time: number) {}
}

/** A regular expression backed by the host engine; `lastIndex` state lives on the host regex. */
export class SandboxRegExp {
  readonly regex: RegExp
  constructor(pattern: string, flags: string) {
    this.regex = new RegExp(pattern, flags)
  }
}

/** A keyed collection with SameValueZero keys. */
export class SandboxMap {
  readonly map = new Map<unknown, unknown>()
}

/** A unique-value collection. */
export class SandboxSet {
  readonly set = new Set<unknown>()
}

export const isSandboxValue = (value: unknown): value is SandboxDate | SandboxRegExp | SandboxMap | SandboxSet =>
  value instanceof SandboxDate || value instanceof SandboxRegExp || value instanceof SandboxMap || value instanceof SandboxSet
