import { Agent } from "@/agent/agent"
import { Auth } from "@/auth"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { Plugin } from "@/plugin"
import { Provider, ProviderTransform } from "@/provider"
import { Skill } from "@/skill"
import { Log } from "@/util/log"
import { Cause, Context, Deferred, Effect, Exit, Layer, Option, Queue, Scope, Stream } from "effect"
import { TeamMemory } from "./memory"
import { plan, translateBlocks } from "./translate-blocks"

const log = Log.create({ service: "memory-translate" })

type Signal = {
  ids?: string[]
  done?: Deferred.Deferred<number, Error>
}

type State = {
  q: Queue.Queue<Signal>
  scope: Scope.Closeable
}

function uniq(list?: string[]) {
  if (!list?.length) return []
  return Array.from(new Set(list.filter(Boolean)))
}

function lang(code: string) {
  if (code === "tr") return "Turkish"
  if (code === "de") return "German"
  if (code === "es") return "Spanish"
  if (code === "fr") return "French"
  if (code === "ja") return "Japanese"
  if (code === "ko") return "Korean"
  if (code === "pl") return "Polish"
  if (code === "ru") return "Russian"
  if (code === "ar") return "Arabic"
  if (code === "da") return "Danish"
  if (code === "no") return "Norwegian Bokmal"
  if (code === "br") return "Brazilian Portuguese"
  if (code === "th") return "Thai"
  if (code === "bs") return "Bosnian"
  if (code === "zh") return "Simplified Chinese"
  if (code === "zht") return "Traditional Chinese"
  return code
}

function localeForProvider(code: string) {
  if (code === "tr") return "tr-TR"
  if (code === "de") return "de-DE"
  if (code === "es") return "es-ES"
  if (code === "fr") return "fr-FR"
  if (code === "ja") return "ja-JP"
  if (code === "ko") return "ko-KR"
  if (code === "pl") return "pl-PL"
  if (code === "ru") return "ru-RU"
  if (code === "ar") return "ar-AE"
  if (code === "da") return "da-DK"
  if (code === "no") return "nb-NO"
  if (code === "br") return "pt-BR"
  if (code === "th") return "th-TH"
  if (code === "bs") return "bs-BA"
  if (code === "zh") return "zh-CN"
  if (code === "zht") return "zh-TW"
  return code
}

function done(item: TeamMemory.Entry, code: string) {
  return (
    item.is_translate &&
    item.translate_status === TeamMemory.TranslateStatus.enum.finished &&
    item.ui_locale === code &&
    !!item.title_ui &&
    !!item.content_ui
  )
}

function busy(item: TeamMemory.Entry) {
  return (
    item.translate_status === TeamMemory.TranslateStatus.enum.waiting ||
    item.translate_status === TeamMemory.TranslateStatus.enum.started
  )
}

function need(item: TeamMemory.Entry, code: string) {
  if (busy(item)) return false
  return !done(item, code)
}

function pick(item: TeamMemory.Entry, code: string) {
  return item.is_translate && item.ui_locale === code && !done(item, code)
}

export namespace MemoryTranslate {
  export interface Interface {
    readonly init: () => Effect.Effect<void>
    readonly translate: (input?: { all?: boolean; ids?: string[]; wait?: boolean }) => Effect.Effect<number, Error>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/MemoryTranslate") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const agent = yield* Agent.Service
      const auth = yield* Auth.Service
      const bus = yield* Bus.Service
      const cfg = yield* Config.Service
      const memory = yield* TeamMemory.Service
      const provider = yield* Provider.Service

      const active = Effect.fn("MemoryTranslate.active")(function* () {
        const code = yield* cfg.get().pipe(Effect.map((item) => item.locale?.trim().toLowerCase() ?? ""))
        if (!code || code === "en") return
        const ag = (yield* agent.list()).find((item) => item.name === "translate-agent")
        if (!ag) return
        return { code, ag }
      })

      const mark = Effect.fn("MemoryTranslate.mark")(function* (input: {
        id: string
        ui: {
          title_ui?: string
          content_ui?: string
          ui_locale?: string
        }
        translate: {
          is_translate: boolean
          translate_status: TeamMemory.TranslateStatus
          translate_done?: number
          translate_total?: number
          translate_updated?: number
        }
      }) {
        const item = yield* memory.get({ id: input.id })
        if (!item) return
        return yield* memory.write({
          id: item.id,
          area: item.area,
          class: item.class,
          kind: item.kind,
          domain: item.domain,
          title: item.title,
          content: item.content,
          scope: item.scope,
          tags: item.tags,
          status: item.status,
          source_id: item.source_id,
          payload: item.payload,
          meta: item.meta,
          title_ui: input.ui.title_ui,
          content_ui: input.ui.content_ui,
          ui_locale: input.ui.ui_locale,
          is_translate: input.translate.is_translate,
          translate_status: input.translate.translate_status,
          translate_done: input.translate.translate_done,
          translate_total: input.translate.translate_total,
          translate_updated: input.translate.translate_updated,
          sessionID: item.session_id,
          actor: item.updated_by,
        })
      })

      const claim = Effect.fn("MemoryTranslate.claim")(function* (input?: { all?: boolean; ids?: string[] }) {
        const ready = yield* active()
        if (!ready) return []
        const list = input?.all
          ? yield* memory.list({ limit: 1000 })
          : yield* Effect.forEach(uniq(input?.ids), (id) => memory.get({ id }), { concurrency: 8 })
        const rows = list.filter((item): item is TeamMemory.Entry => !!item).filter((item) => need(item, ready.code))
        yield* Effect.forEach(
          rows,
          (item) =>
            mark({
              id: item.id,
              ui: {
                title_ui: item.title_ui,
                content_ui: item.content_ui,
                ui_locale: ready.code,
              },
              translate: {
                is_translate: true,
                translate_status: TeamMemory.TranslateStatus.enum.waiting,
                translate_done: 0,
                translate_total: 0,
                translate_updated: Date.now(),
              },
            }),
          { concurrency: 1 },
        )
        return rows.map((item) => item.id)
      })

      const run = Effect.fn("MemoryTranslate.run")(function* (ids?: string[]) {
        const ready = yield* active()
        if (!ready) return 0

        const list = yield* Effect.forEach(uniq(ids), (id) => memory.get({ id }), { concurrency: 8 })
        const rows = list.filter((item): item is TeamMemory.Entry => !!item).filter((item) => pick(item, ready.code))
        if (rows.length === 0) return 0

        const ag = ready.ag
        const base = ag.model ?? (yield* provider.defaultModel())
        const full = yield* provider.getModel(base.providerID, base.modelID)
        const picks = ag.model ? [full] : [yield* provider.getSmallModel(base.providerID), full].filter(Boolean)
        const token = yield* auth.get(full.providerID).pipe(Effect.orDie)
        const models = yield* Effect.forEach(
          picks.filter(
            (item, idx, list): item is typeof full =>
              !!item && list.findIndex((x) => x?.providerID === item.providerID && x?.id === item.id) === idx,
          ),
          (mdl) =>
            Effect.gen(function* () {
              const language = yield* provider.getLanguage(mdl)
              const temp = mdl.capabilities.temperature
                ? (ag.temperature ?? ProviderTransform.temperature(mdl))
                : undefined
              const opts = {
                ...(!ag.model && mdl.id !== full.id ? ProviderTransform.smallOptions(mdl) : {}),
                ...(mdl.providerID === "openai" && token?.type === "oauth" ? { store: false } : {}),
              }
              return {
                model: mdl,
                language,
                options: opts,
                prompt: ag.prompt ?? "",
                oauth: mdl.providerID === "openai" && token?.type === "oauth",
                ...(temp === undefined ? {} : { temperature: temp }),
              }
            }),
          { concurrency: 1 },
        )
        let count = 0

        for (const item of rows) {
          const work = plan([
            {
              id: item.id,
              fields: {
                title: item.title,
                content: item.content,
              },
            },
          ])
          const total = work.total.get(item.id) ?? 0
          yield* mark({
            id: item.id,
            ui: {
              title_ui: item.title_ui,
              content_ui: item.content_ui,
              ui_locale: ready.code,
            },
            translate: {
              is_translate: true,
              translate_status: TeamMemory.TranslateStatus.enum.started,
              translate_done: 0,
              translate_total: total,
              translate_updated: Date.now(),
            },
          })
          const exit = yield* Effect.promise(() =>
            translateBlocks({
              locale: localeForProvider(ready.code),
              title: `Translate memory UI fields literally from English to ${lang(ready.code)} (${ready.code})`,
              model: models,
              plan: work,
              onProgress: async ({ done, total }) => {
                await Effect.runPromise(
                  mark({
                    id: item.id,
                    ui: {
                      title_ui: item.title_ui,
                      content_ui: item.content_ui,
                      ui_locale: ready.code,
                    },
                    translate: {
                      is_translate: true,
                      translate_status: TeamMemory.TranslateStatus.enum.started,
                      translate_done: done,
                      translate_total: total,
                      translate_updated: Date.now(),
                    },
                  }),
                )
              },
            }),
          ).pipe(Effect.exit)
          if (Exit.isFailure(exit)) {
            yield* mark({
              id: item.id,
              ui: {
                title_ui: item.title_ui,
                content_ui: item.content_ui,
                ui_locale: item.ui_locale,
              },
              translate: {
                is_translate: false,
                translate_status: TeamMemory.TranslateStatus.enum.idle,
                translate_done: 0,
                translate_total: 0,
                translate_updated: Date.now(),
              },
            })
            const err = Cause.squash(exit.cause)
            return yield* Effect.fail(err instanceof Error ? err : new Error(String(err)))
          }
          const next = exit.value.fields.get(item.id)
          if (!next) continue
          yield* mark({
            id: item.id,
            ui: {
              title_ui: next.title,
              content_ui: next.content,
              ui_locale: ready.code,
            },
            translate: {
              is_translate: true,
              translate_status: TeamMemory.TranslateStatus.enum.finished,
              translate_done: total,
              translate_total: total,
              translate_updated: Date.now(),
            },
          })
          count += 1
        }

        return count
      })

      const state = yield* InstanceState.make<State>(
        Effect.fn("MemoryTranslate.state")(function* () {
          const q = yield* Queue.unbounded<Signal>()
          const scope = yield* Scope.make()

          const loop = Effect.forever(
            Effect.gen(function* () {
              const first = yield* Queue.take(q)
              yield* Effect.sleep("300 millis")

              const list: Signal[] = [first]
              while (true) {
                const next = yield* Queue.poll(q)
                if (Option.isNone(next)) break
                list.push(next.value)
              }

              const ids = uniq(list.flatMap((item) => item.ids ?? []))
              const done = list.flatMap((item) => (item.done ? [item.done] : []))
              if (ids.length === 0) {
                yield* Effect.forEach(done, (item) => Deferred.succeed(item, 0), { discard: true })
                return
              }

              const exit = yield* run(ids).pipe(Effect.exit)
              if (Exit.isSuccess(exit)) {
                yield* Effect.forEach(done, (item) => Deferred.succeed(item, exit.value), { discard: true })
                return
              }

              const err = Cause.squash(exit.cause)
              yield* Effect.sync(() => log.error("memory translate failed", { error: err }))
              yield* Effect.forEach(
                done,
                (item) => Deferred.fail(item, err instanceof Error ? err : new Error(String(err))),
                { discard: true },
              )
            }),
          ).pipe(Effect.forkScoped)

          yield* Scope.provide(scope)(
            bus.subscribe(TeamMemory.Event.Updated).pipe(
              Stream.runForEach((evt) =>
                claim({ ids: [evt.properties.entry.id] }).pipe(
                  Effect.flatMap((ids) => (ids.length > 0 ? Queue.offer(q, { ids }) : Effect.void)),
                ),
              ),
              Effect.forkScoped,
            ),
          )

          yield* Scope.provide(scope)(loop)
          yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
          return { q, scope }
        }),
      )

      const init = Effect.fn("MemoryTranslate.init")(function* () {
        yield* InstanceState.get(state)
      })

      const translate = Effect.fn("MemoryTranslate.translate")(function* (input?: {
        all?: boolean
        ids?: string[]
        wait?: boolean
      }) {
        const ids = yield* claim(input)
        if (ids.length === 0) return 0
        const next = yield* InstanceState.get(state)
        const done = input?.wait ? yield* Deferred.make<number, Error>() : undefined
        yield* Queue.offer(next.q, { ids, done })
        if (!done) return 0
        return yield* Deferred.await(done)
      })

      return Service.of({ init, translate })
    }),
  )

  export const defaultLayer = Layer.unwrap(
    Effect.sync(() =>
      layer.pipe(
        Layer.provide(TeamMemory.layer),
        Layer.provide(Agent.layer),
        Layer.provide(Plugin.defaultLayer),
        Layer.provide(Provider.defaultLayer),
        Layer.provide(Auth.defaultLayer),
        Layer.provide(Config.defaultLayer),
        Layer.provide(Skill.defaultLayer),
        Layer.provide(Bus.layer),
      ),
    ),
  )
}

const runtime = makeRuntime(MemoryTranslate.Service, MemoryTranslate.defaultLayer)

export async function init() {
  return runtime.runPromise((svc) => svc.init())
}

export async function translate(input?: { all?: boolean; ids?: string[]; wait?: boolean }) {
  return runtime.runPromise((svc) => svc.translate(input))
}

const memoryTranslateRuntime = { init, translate }

export namespace MemoryTranslate {
  export const init = () => memoryTranslateRuntime.init()
  export const translate = (...args: Parameters<typeof import("./memory-translate").translate>) =>
    memoryTranslateRuntime.translate(...args)
}
