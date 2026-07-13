import type { Fiber } from "effect"

export class CodeModePromise {
  constructor(readonly fiber: Fiber.Fiber<unknown, unknown>) {}
}

export class CodeModeDate {
  constructor(readonly time: number) {}
}

export class CodeModeRegExp {
  readonly regex: RegExp
  constructor(pattern: string, flags: string) {
    this.regex = new RegExp(pattern, flags)
  }
}

export class CodeModeMap {
  readonly map = new Map<unknown, unknown>()
}

export class CodeModeSet {
  readonly set = new Set<unknown>()
}

export class CodeModeURLSearchParams {
  constructor(readonly params: URLSearchParams) {}
}

export class CodeModeURL {
  readonly searchParams: CodeModeURLSearchParams
  constructor(readonly url: URL) {
    this.searchParams = new CodeModeURLSearchParams(url.searchParams)
  }
}

export const isCodeModeValue = (
  value: unknown,
): value is CodeModeDate | CodeModeRegExp | CodeModeMap | CodeModeSet | CodeModeURL | CodeModeURLSearchParams =>
  value instanceof CodeModeDate ||
  value instanceof CodeModeRegExp ||
  value instanceof CodeModeMap ||
  value instanceof CodeModeSet ||
  value instanceof CodeModeURL ||
  value instanceof CodeModeURLSearchParams
