import { createEffect, onCleanup, onMount } from "solid-js"
import { isFreeModel } from "@/providers/models/models"
import { useLanguage } from "@/runtime/i18n/language"
import { useData } from "@/runtime/server/current"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useUsageFormat } from "./format"
import { modelUsage, servedByConsole, type LimitedModel } from "./limits"

/**
 * The member's Console usage limits for this location: undefined until loaded, null when signed out. Only OpenCode
 * Console limits models, so only a model it serves loads them. Spend moves with every request, so loaded limits reload
 * as the session's turns end.
 */
export function createUsageLimits(input: {
  model: () => LimitedModel | undefined
  sessionID?: () => string | undefined
}) {
  const data = useData()
  const location = useWorkspaceLocation()
  const limits = () => data.location.usage.limits(location().ref)
  const load = () => void data.location.usage.sync(location().ref).catch(() => undefined)
  createEffect(() => {
    const model = input.model()
    if (model && servedByConsole(model) && limits() === undefined) load()
  })
  onCleanup(
    data.on("session.execution.succeeded", (event) => {
      if (event.data.sessionID !== input.sessionID?.() || !limits()) return
      data.location.usage.invalidate(location().ref)
      load()
    }),
  )
  return limits
}

/** What a paid model has left under the member's Console budgets, written for the model picker. */
export type ModelUsageLabel = {
  /** The row's label: the dollars left, or that a budget is reached. */
  readonly label: string
  readonly reached: boolean
  readonly left: string
  readonly resets: string
}

/**
 * Labels models with what the member's Console budgets leave for them, loading the budgets once. Spend moves with every
 * request, so `refresh` reloads them on mount, showing the ones already loaded meanwhile.
 */
export function createModelUsage(options: { refresh?: boolean } = {}) {
  const data = useData()
  const location = useWorkspaceLocation()
  const language = useLanguage()
  const format = useUsageFormat()
  onMount(() => {
    if (options.refresh) data.location.usage.invalidate(location().ref)
    void data.location.usage.sync(location().ref).catch(() => undefined)
  })
  return (model: Parameters<typeof modelUsage>[1] & Parameters<typeof isFreeModel>[0]): ModelUsageLabel | undefined => {
    const info = data.location.usage.limits(location().ref)
    const usage = info && !isFreeModel(model) ? modelUsage(info, model) : undefined
    if (!usage) return
    return {
      label: usage.reached
        ? language.t("usage.budget.reached")
        : language.t("usage.budget.left", { amount: format.money(usage.left) }),
      reached: usage.reached,
      left: format.money(usage.left),
      resets: format.shortTime(usage.resetsAt),
    }
  }
}

/** What the member's Console budgets leave for a paid model, always shown on its row in the model picker. */
export function ModelUsageTag(props: { usage: ModelUsageLabel }) {
  return (
    <span
      class={`shrink-0 tabular-nums ${props.usage.reached ? "text-v2-state-fg-danger" : "text-v2-text-text-faint"}`}
    >
      {props.usage.label}
    </span>
  )
}
