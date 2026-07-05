import type { Effect, Fiber } from "effect"

export class SandboxPromise {
  interrupted = false
  constructor(
    readonly fiber: Fiber.Fiber<unknown, unknown> | undefined,
    readonly immediate?: Effect.Effect<unknown, unknown>,
  ) {}
}

export class SandboxDate {
  constructor(readonly time: number) {}
}

export class SandboxRegExp {
  readonly regex: RegExp
  constructor(pattern: string, flags: string) {
    this.regex = new RegExp(pattern, flags)
  }
}

export class SandboxMap {
  readonly map = new Map<unknown, unknown>()
}

export class SandboxSet {
  readonly set = new Set<unknown>()
}

export const isSandboxValue = (value: unknown): value is SandboxDate | SandboxRegExp | SandboxMap | SandboxSet =>
  value instanceof SandboxDate ||
  value instanceof SandboxRegExp ||
  value instanceof SandboxMap ||
  value instanceof SandboxSet
