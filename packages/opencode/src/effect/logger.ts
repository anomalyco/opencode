import { Cause, Effect, Logger, References } from "effect"
import { Log } from "@/util/log"

export namespace EffectLogger {
  type Fields = Record<string, unknown>

  export interface Handle {
    readonly debug: (msg?: unknown, extra?: Fields) => Effect.Effect<void>
    readonly info: (msg?: unknown, extra?: Fields) => Effect.Effect<void>
    readonly warn: (msg?: unknown, extra?: Fields) => Effect.Effect<void>
    readonly error: (msg?: unknown, extra?: Fields) => Effect.Effect<void>
    readonly with: (extra: Fields) => Handle
  }

  const clean = (input?: Fields): Fields =>
    Object.fromEntries(Object.entries(input ?? {}).filter((entry) => entry[1] !== undefined && entry[1] !== null))

  const text = (input: unknown): string => {
    if (Array.isArray(input)) return input.map((item) => String(item)).join(" ")
    return input === undefined ? "" : String(input)
  }

  const call = (run: (msg?: unknown) => Effect.Effect<void>, base: Fields, msg?: unknown, extra?: Fields) => {
    const ann = clean({ ...base, ...extra })
    const fx = run(msg)
    return Object.keys(ann).length ? Effect.annotateLogs(fx, ann) : fx
  }

  export const logger = Logger.make((opts) => {
    const extra = clean(opts.fiber.getRef(References.CurrentLogAnnotations))
    const now = opts.date.getTime()
    for (const [key, start] of opts.fiber.getRef(References.CurrentLogSpans)) {
      extra[`logSpan.${key}`] = `${now - start}ms`
    }
    if (opts.cause.reasons.length > 0) {
      extra.cause = Cause.pretty(opts.cause)
    }

    const svc = typeof extra.service === "string" ? extra.service : undefined
    if (svc) delete extra.service
    const log = svc ? Log.create({ service: svc }) : Log.Default
    const msg = text(opts.message)

    switch (opts.logLevel) {
      case "Trace":
      case "Debug":
        return log.debug(msg, extra)
      case "Warn":
        return log.warn(msg, extra)
      case "Error":
      case "Fatal":
        return log.error(msg, extra)
      default:
        return log.info(msg, extra)
    }
  })

  export const layer = Logger.layer([logger], { mergeWithExisting: false })

  export const create = (base: Fields = {}): Handle => ({
    debug: (msg, extra) => call((item) => Effect.logDebug(item), base, msg, extra),
    info: (msg, extra) => call((item) => Effect.logInfo(item), base, msg, extra),
    warn: (msg, extra) => call((item) => Effect.logWarning(item), base, msg, extra),
    error: (msg, extra) => call((item) => Effect.logError(item), base, msg, extra),
    with: (extra) => create({ ...base, ...extra }),
  })
}
