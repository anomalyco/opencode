import * as prompts from "@clack/prompts"
import { Effect, Option } from "effect"

export const intro = (msg: string) => Effect.sync(() => prompts.intro(msg))
export const outro = (msg: string) => Effect.sync(() => prompts.outro(msg))

export const log = {
  info: (msg: string) => Effect.sync(() => prompts.log.info(msg)),
  error: (msg: string) => Effect.sync(() => prompts.log.error(msg)),
  warn: (msg: string) => Effect.sync(() => prompts.log.warn(msg)),
  success: (msg: string) => Effect.sync(() => prompts.log.success(msg)),
}

const optional = <Value>(result: Value | symbol) => {
  if (prompts.isCancel(result)) return Option.none<Value>()
  return Option.some(result)
}

export const select = <Value>(opts: Parameters<typeof prompts.select<Value>>[0]) =>
  Effect.promise(() => prompts.select(opts)).pipe(Effect.map((result) => optional(result)))

export const autocomplete = <Value>(opts: Parameters<typeof prompts.autocomplete<Value>>[0]) =>
  Effect.promise(() => prompts.autocomplete(opts)).pipe(Effect.map((result) => optional(result)))

export const text = (opts: Parameters<typeof prompts.text>[0]) =>
  Effect.promise(() => prompts.text(opts)).pipe(Effect.map((result) => optional(result)))

export const password = (opts: Parameters<typeof prompts.password>[0]) =>
  Effect.promise(() => prompts.password(opts)).pipe(Effect.map((result) => optional(result)))

export const spinner = () => {
  const s = prompts.spinner()
  return {
    start: (msg: string) => Effect.sync(() => s.start(msg)),
    stop: (msg: string, code?: number) => Effect.sync(() => s.stop(msg, code)),
  }
}
