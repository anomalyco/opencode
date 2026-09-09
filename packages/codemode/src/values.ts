export * as Values from "./values.js"

import type { Fiber } from "effect"

/**
 * Runtime values the interpreter recognizes by class. Each wraps the host value it stands for,
 * so hosts construct these to hand a value to a program and receive them back unchanged.
 */

export class Promise {
  constructor(readonly fiber: Fiber.Fiber<unknown, unknown>) {}
}

export class Date {
  constructor(public time: number) {}
}

export class RegExp {
  readonly regex: globalThis.RegExp
  constructor(pattern: string, flags: string) {
    this.regex = new globalThis.RegExp(pattern, flags)
  }

  get lastIndex(): unknown {
    return Reflect.get(this.regex, "lastIndex")
  }

  set lastIndex(value: unknown) {
    Reflect.set(this.regex, "lastIndex", value)
  }
}

export class Map {
  readonly map = new globalThis.Map<unknown, unknown>()
}

export class Set {
  readonly set = new globalThis.Set<unknown>()
}

export class URLSearchParams {
  constructor(readonly params: globalThis.URLSearchParams) {}
}

export class URL {
  readonly searchParams: URLSearchParams
  constructor(readonly url: globalThis.URL) {
    this.searchParams = new URLSearchParams(url.searchParams)
  }
}

/** Data-like runtime values; excludes Promise, which never crosses a boundary. */
export const isValue = (value: unknown): value is Date | RegExp | Map | Set | URL | URLSearchParams =>
  value instanceof Date ||
  value instanceof RegExp ||
  value instanceof Map ||
  value instanceof Set ||
  value instanceof URL ||
  value instanceof URLSearchParams
