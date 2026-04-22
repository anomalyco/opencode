import { Agent } from "@/agent/agent"
import { Auth } from "@/auth"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { Instance } from "@/project/instance"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { Skill } from "@/skill"
import { Log } from "@/util/log"
import { Cause, Deferred, Effect, Exit, Layer, Option, Queue, Scope, ServiceMap, Stream } from "effect"
import { TeamMainPlan } from "./main-plan"
import { plan, translateBlocks } from "./translate-blocks"

const log = Log.create({ service: "main-plan-translate" })

type Signal = {
  ids?: string[]
  done?: Deferred.Deferred<number, Error>
}

type State = {
  q: Queue.Queue<Signal>
  scope: Scope.Closeable
  tracked: Set<string>
}

type SourceSnapshot = Pick<TeamMainPlan.Plan, "title" | "goal" | "scope" | "target">

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

function needs(item: TeamMainPlan.Plan, locale: string) {
  if (
    item.is_translate &&
    item.translate_status === "finished" &&
    item.ui_locale === locale &&
    item.title_ui &&
    item.goal_ui &&
    item.scope_ui &&
    item.target_ui
  ) {
    return false
  }
  if (item.translate_status === "waiting" || item.translate_status === "started") {
    return false
  }
  return true
}

function pick(item: TeamMainPlan.Plan, locale: string) {
  return (
    item.is_translate &&
    item.ui_locale === locale &&
    !(item.translate_status === "finished" && item.title_ui && item.goal_ui && item.scope_ui && item.target_ui)
  )
}

function waiting_fields(item: TeamMainPlan.Plan, locale: string) {
  if (item.ui_locale !== locale) {
    return {
      title_ui: undefined,
      goal_ui: undefined,
      scope_ui: undefined,
      target_ui: undefined,
    }
  }
  return {
    title_ui: item.title_ui,
    goal_ui: item.goal_ui,
    scope_ui: item.scope_ui,
    target_ui: item.target_ui,
  }
}

function source(item: SourceSnapshot): SourceSnapshot {
  return {
    title: item.title,
    goal: item.goal,
    scope: item.scope,
    target: item.target,
  }
}

function same_source(plan: SourceSnapshot, expected: SourceSnapshot) {
  return (
    plan.title === expected.title &&
    plan.goal === expected.goal &&
    plan.scope === expected.scope &&
    plan.target === expected.target
  )
}

export namespace MainPlanTranslate {
  export interface Interface {
    readonly init: () => Effect.Effect<void>
    readonly translate: (input?: { all?: boolean; ids?: string[]; wait?: boolean }) => Effect.Effect<number, Error>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/MainPlanTranslate") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const agent = yield* Agent.Service
      const auth = yield* Auth.Service
      const bus = yield* Bus.Service
      const cfg = yield* Config.Service
      const provider = yield* Provider.Service

      const active = Effect.fn("MainPlanTranslate.active")(function* () {
        const code = yield* cfg.get().pipe(Effect.map((item) => item.locale?.trim().toLowerCase() ?? ""))
        if (!code || code === "en") return
        const ag = (yield* agent.list()).find((item) => item.name === "translate-agent")
        if (!ag) return
        return { code, ag }
      })

      const mark = Effect.fn("MainPlanTranslate.mark")(function* (input: {
        id: string
        source?: SourceSnapshot
        patch: Partial<TeamMainPlan.Plan> & {
          is_translate?: boolean
          translate_status?: "idle" | "waiting" | "started" | "finished"
          translate_done?: number
          translate_total?: number
          translate_updated?: number
        }
      }) {
        const fresh = yield* Effect.promise(() =>
          TeamMainPlan.update_if(
            input.id,
            (plan) => !input.source || same_source(plan, input.source),
            (plan) => ({
              ...plan,
              ...input.patch,
              translate_updated: input.patch.translate_updated ?? Date.now(),
            }),
          ),
        )
        if (!fresh) return
        yield* bus.publish(TeamMainPlan.Event.Updated, {
          change: "set",
          plan: fresh.plan,
          file: fresh.file,
        })
        return fresh
      })

      const claim = Effect.fn("MainPlanTranslate.claim")(function* (input?: { all?: boolean; ids?: string[] }) {
        const ready = yield* active()
        if (!ready) return []
        const list = yield* Effect.promise(() => TeamMainPlan.list())
        const rows = (input?.all ? list : list.filter((item) => uniq(input?.ids).includes(item.id))).filter((item) =>
          needs(item, ready.code),
        )
        const claimed = yield* Effect.forEach(
          rows,
          (item) =>
            mark({
              id: item.id,
              source: source(item),
              patch: {
                ...waiting_fields(item, ready.code),
                ui_locale: ready.code,
                is_translate: true,
                translate_status: "waiting",
                translate_done: 0,
                translate_total: 0,
                translate_updated: Date.now(),
              },
            }),
          { concurrency: 1 },
        )
        return rows.filter((_item, idx) => !!claimed[idx]).map((item) => item.id)
      })

      const run = Effect.fn("MainPlanTranslate.run")(function* (ids?: string[]) {
        const ready = yield* active()
        if (!ready) return 0

        const list = yield* Effect.promise(() => TeamMainPlan.list())
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
          const expected = source(item)
          const work = plan([
            {
              id: item.id,
              fields: {
                title: item.title,
                goal: item.goal,
                scope: item.scope,
                target: item.target,
              },
            },
          ])
          const total = work.total.get(item.id) ?? 0
          const started = yield* mark({
            id: item.id,
            source: expected,
            patch: {
              ui_locale: ready.code,
              is_translate: true,
              translate_status: "started",
              translate_done: 0,
              translate_total: total,
              translate_updated: Date.now(),
            },
          })
          if (!started) continue
          const exit = yield* Effect.promise(() =>
            translateBlocks({
              locale: localeForProvider(ready.code),
              title: `Translate main plan UI fields literally from English to ${lang(ready.code)} (${ready.code})`,
              model: models,
              plan: work,
              onProgress: async ({ done, total }) => {
                await Effect.runPromise(
                  mark({
                    id: item.id,
                    source: expected,
                    patch: {
                      ui_locale: ready.code,
                      is_translate: true,
                      translate_status: "started",
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
              source: expected,
              patch: {
                ui_locale: item.ui_locale,
                is_translate: false,
                translate_status: "idle",
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
          const finished = yield* mark({
            id: item.id,
            source: expected,
            patch: {
              title_ui: next.title,
              goal_ui: next.goal,
              scope_ui: next.scope,
              target_ui: next.target,
              ui_locale: ready.code,
              is_translate: true,
              translate_status: "finished",
              translate_done: total,
              translate_total: total,
              translate_updated: Date.now(),
            },
          })
          if (finished) count += 1
        }

        return count
      })

      const state = yield* InstanceState.make<State>(
        Effect.fn("MainPlanTranslate.state")(function* () {
          const q = yield* Queue.unbounded<Signal>()
          const scope = yield* Scope.make()
          const tracked = new Set<string>()

          const settle = Effect.fn("MainPlanTranslate.settle")(function* (ids?: string[]) {
            const list = uniq(ids)
            if (list.length === 0) return
            const plans = yield* Effect.promise(() => TeamMainPlan.list())
            const active = new Set(
              plans
                .filter(
                  (item) =>
                    list.includes(item.id) &&
                    (item.translate_status === "waiting" || item.translate_status === "started"),
                )
                .map((item) => item.id),
            )
            yield* Effect.sync(() => {
              for (const id of list) {
                if (!active.has(id)) tracked.delete(id)
              }
            })
          })

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
                yield* settle(ids)
                yield* Effect.forEach(done, (item) => Deferred.succeed(item, exit.value), { discard: true })
                return
              }

              yield* settle(ids)
              const err = Cause.squash(exit.cause)
              yield* Effect.sync(() => log.error("main-plan translate failed", { error: err }))
              yield* Effect.forEach(
                done,
                (item) => Deferred.fail(item, err instanceof Error ? err : new Error(String(err))),
                { discard: true },
              )
            }),
          ).pipe(Effect.forkScoped)

          yield* Scope.provide(scope)(
            bus.subscribe(TeamMainPlan.Event.Updated).pipe(
              Stream.runForEach((evt) =>
                Effect.gen(function* () {
                  const id = evt.properties.plan.id
                  const watched = yield* Effect.sync(() => tracked.has(id))
                  if (!watched) return
                  const ids = yield* claim({ ids: [id] })
                  if (ids.length === 0) return
                  yield* Queue.offer(q, { ids })
                }),
              ),
              Effect.forkScoped,
            ),
          )
          yield* Scope.provide(scope)(loop)

          yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
          return { q, scope, tracked }
        }),
      )

      const init = Effect.fn("MainPlanTranslate.init")(function* () {
        yield* InstanceState.get(state)
      })

      const translate = Effect.fn("MainPlanTranslate.translate")(function* (input?: {
        all?: boolean
        ids?: string[]
        wait?: boolean
      }) {
        const next = yield* InstanceState.get(state)
        const ids = yield* claim(input)
        if (ids.length === 0) return 0
        yield* Effect.sync(() => {
          for (const id of ids) next.tracked.add(id)
        })
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
