import { Agent } from "@/agent/agent"
import { Auth } from "@/auth"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { Instance } from "@/project/instance"
import { Provider, ProviderTransform } from "@/provider"
import { Skill } from "@/skill"
import { Log } from "@/util/log"
import { Cause, Context, Deferred, Effect, Exit, Layer, Option, Queue, Scope, Stream } from "effect"
import { TeamBugReport } from "./bug-report"
import { plan, translateBlocks } from "./translate-blocks"

const log = Log.create({ service: "bug-report-translate" })

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
  if (code === "no") return "Norwegian Bokmål"
  if (code === "br") return "Brazilian Portuguese"
  if (code === "th") return "Thai"
  if (code === "bs") return "Bosnian"
  if (code === "zh") return "Simplified Chinese"
  if (code === "zht") return "Traditional Chinese"
  return code
}

// Maps locale codes to BCP 47 format for provider requests
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

function needs(item: TeamBugReport.Entry, locale: string) {
  if (
    item.is_translate &&
    item.translate_status === TeamBugReport.TranslateStatus.enum.finished &&
    item.ui_locale === locale &&
    item.title_ui &&
    item.summary_ui &&
    (!item.impact || item.impact_ui) &&
    (!item.repro || item.repro_ui) &&
    (!item.expected || item.expected_ui) &&
    (!item.actual || item.actual_ui) &&
    (!item.suggestion || item.suggestion_ui)
  ) {
    return false
  }
  if (
    item.translate_status === TeamBugReport.TranslateStatus.enum.waiting ||
    item.translate_status === TeamBugReport.TranslateStatus.enum.started
  ) {
    return false
  }
  return true
}

function pick(item: TeamBugReport.Entry, locale: string) {
  return (
    item.is_translate &&
    item.ui_locale === locale &&
    !(
      item.translate_status === TeamBugReport.TranslateStatus.enum.finished &&
      item.title_ui &&
      item.summary_ui &&
      (!item.impact || item.impact_ui) &&
      (!item.repro || item.repro_ui) &&
      (!item.expected || item.expected_ui) &&
      (!item.actual || item.actual_ui) &&
      (!item.suggestion || item.suggestion_ui)
    )
  )
}

export namespace BugReportTranslate {
  export interface Interface {
    readonly init: () => Effect.Effect<void>
    readonly translate: (input?: { all?: boolean; ids?: string[]; wait?: boolean }) => Effect.Effect<number, Error>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/BugReportTranslate") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const agent = yield* Agent.Service
      const auth = yield* Auth.Service
      const bus = yield* Bus.Service
      const cfg = yield* Config.Service
      const provider = yield* Provider.Service

      const active = Effect.fn("BugReportTranslate.active")(function* () {
        const code = yield* cfg.get().pipe(Effect.map((item) => item.locale?.trim().toLowerCase() ?? ""))
        if (!code || code === "en") return
        const ag = (yield* agent.list()).find((item) => item.name === "translate-agent")
        if (!ag) return
        return { code, ag }
      })

      const mark = Effect.fn("BugReportTranslate.mark")(function* (input: {
        id: string
        patch: TeamBugReport.Patch & {
          is_translate?: boolean
          translate_status?: TeamBugReport.TranslateStatus
          translate_done?: number
          translate_total?: number
          translate_updated?: number
        }
      }) {
        const fresh = yield* Effect.promise(() =>
          TeamBugReport.update({
            root: Instance.worktree,
            id: input.id,
            patch: input.patch,
          }),
        )
        if (!fresh) return
        yield* bus.publish(TeamBugReport.Event.Updated, {
          projectID: fresh.project_id,
          entry: fresh,
          file: TeamBugReport.file,
        })
        return fresh
      })

      const claim = Effect.fn("BugReportTranslate.claim")(function* (input?: { all?: boolean; ids?: string[] }) {
        const ready = yield* active()
        if (!ready) return []
        const list = yield* Effect.promise(() => TeamBugReport.list(Instance.worktree))
        const rows = (input?.all ? list : list.filter((item) => uniq(input?.ids).includes(item.id))).filter((item) =>
          needs(item, ready.code),
        )
        yield* Effect.forEach(
          rows,
          (item) =>
            mark({
              id: item.id,
              patch: {
                ui_locale: ready.code,
                is_translate: true,
                translate_status: TeamBugReport.TranslateStatus.enum.waiting,
                translate_done: 0,
                translate_total: 0,
                translate_updated: Date.now(),
              },
            }),
          { concurrency: 1 },
        )
        return rows.map((item) => item.id)
      })

      const run = Effect.fn("BugReportTranslate.run")(function* (ids?: string[]) {
        const ready = yield* active()
        if (!ready) return 0

        const list = yield* Effect.promise(() => TeamBugReport.list(Instance.worktree))
        const rows = list.filter((item) => uniq(ids).includes(item.id)).filter((item) => pick(item, ready.code))
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
                summary: item.summary,
                impact: item.impact,
                repro: item.repro,
                expected: item.expected,
                actual: item.actual,
                suggestion: item.suggestion,
              },
            },
          ])
          const total = work.total.get(item.id) ?? 0
          yield* mark({
            id: item.id,
            patch: {
              ui_locale: ready.code,
              is_translate: true,
              translate_status: TeamBugReport.TranslateStatus.enum.started,
              translate_done: 0,
              translate_total: total,
              translate_updated: Date.now(),
            },
          })
          const exit = yield* Effect.promise(() =>
            translateBlocks({
              locale: localeForProvider(ready.code),
              title: `Translate bug report UI fields literally from English to ${lang(ready.code)} (${ready.code})`,
              model: models,
              plan: work,
              onProgress: async ({ done, total }) => {
                await Effect.runPromise(
                  mark({
                    id: item.id,
                    patch: {
                      ui_locale: ready.code,
                      is_translate: true,
                      translate_status: TeamBugReport.TranslateStatus.enum.started,
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
              patch: {
                ui_locale: item.ui_locale,
                is_translate: false,
                translate_status: TeamBugReport.TranslateStatus.enum.idle,
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
            patch: {
              title_ui: next.title,
              summary_ui: next.summary,
              impact_ui: next.impact,
              repro_ui: next.repro,
              expected_ui: next.expected,
              actual_ui: next.actual,
              suggestion_ui: next.suggestion,
              ui_locale: ready.code,
              is_translate: true,
              translate_status: TeamBugReport.TranslateStatus.enum.finished,
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
        Effect.fn("BugReportTranslate.state")(function* () {
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
              yield* Effect.sync(() => log.error("bug report translate failed", { error: err }))
              yield* Effect.forEach(
                done,
                (item) => Deferred.fail(item, err instanceof Error ? err : new Error(String(err))),
                { discard: true },
              )
            }),
          ).pipe(Effect.forkScoped)

          const sub = (event: typeof TeamBugReport.Event.Created | typeof TeamBugReport.Event.Updated) =>
            Scope.provide(scope)(
              bus.subscribe(event).pipe(
                Stream.runForEach((evt) =>
                  claim({ ids: [evt.properties.entry.id] }).pipe(
                    Effect.flatMap((ids) => (ids.length > 0 ? Queue.offer(q, { ids }) : Effect.void)),
                  ),
                ),
                Effect.forkScoped,
              ),
            )

          yield* sub(TeamBugReport.Event.Created)
          yield* sub(TeamBugReport.Event.Updated)
          yield* Scope.provide(scope)(loop)

          yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
          return { q, scope }
        }),
      )

      const init = Effect.fn("BugReportTranslate.init")(function* () {
        yield* InstanceState.get(state)
      })

      const translate = Effect.fn("BugReportTranslate.translate")(function* (input?: {
        all?: boolean
        ids?: string[]
        wait?: boolean
      }) {
        const ids = yield* claim(input)
        if (ids.length === 0) return 0
        const next = yield* InstanceState.get(state)
        const done = input?.wait ? yield* Deferred.make<number, Error>() : undefined
        yield* Queue.offer(next.q, { ids, done })
        if (!done) return ids.length
        return yield* Deferred.await(done)
      })

      return Service.of({ init, translate })
    }),
  )

  export const defaultLayer = Layer.unwrap(
    Effect.sync(() =>
      layer.pipe(
        Layer.provide(Agent.layer),
        Layer.provide(Provider.defaultLayer),
        Layer.provide(Auth.defaultLayer),
        Layer.provide(Config.defaultLayer),
        Layer.provide(Skill.defaultLayer),
        Layer.provide(Bus.layer),
      ),
    ),
  )

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function init() {
    return runPromise((svc) => svc.init())
  }

  export async function translate(input?: { all?: boolean; ids?: string[]; wait?: boolean }) {
    return runPromise((svc) => svc.translate(input))
  }
}
