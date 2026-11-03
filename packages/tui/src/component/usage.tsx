import type { ModelInfo, SessionMessageAssistant } from "@opencode/client"
import { TextAttributes } from "@opentui/core"
import { createEffect, createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { useData } from "../context/data"
import { Keymap } from "../context/keymap"
import { useLocal } from "../context/local"
import { useLocation } from "../context/location"
import { useTheme } from "../context/theme"
import { SplitBorder } from "../ui/border"
import { Link } from "../ui/link"
import { DIALOG_LIST_INSET, DialogHeader, DialogLayout, useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useToast } from "../ui/toast"
import {
  formatDollars,
  formatReset,
  limitScope,
  modelUsage,
  goLimitLink,
  goLimitName,
  refusalReset,
  retryReset,
  servedByConsole,
  usageLevel,
  type ModelUsage,
} from "../util/usage-limits"
import { createLanguage } from "../i18n/translate"
import { useLanguage } from "../context/language"

/**
 * The OpenCode Console limits on this location's models. Limits load once; `refresh` reloads them, since spend moves
 * with every request, and keeps showing the ones already loaded meanwhile.
 */
export function useUsageLimits() {
  const data = useData()
  const location = useLocation()
  const ref = () => location.ref ?? data.location.default()
  const providers = createMemo(() => new Map((data.location.provider.list(ref()) ?? []).map((item) => [item.id, item])))
  const info = () => data.location.usage.limits(ref())
  const usage = (model: ModelInfo) => {
    const value = info()
    return value ? modelUsage(value, model, providers().get(model.providerID)) : undefined
  }
  return {
    /** Undefined until loaded, and null when the location isn't signed in to OpenCode Console. */
    info,
    load: (refresh = false) => {
      if (refresh) data.location.usage.invalidate(ref())
      void data.location.usage.sync(ref()).catch(() => undefined)
    },
    models: () => data.location.model.list(ref()) ?? [],
    usage,
    served: (providerID: string) => servedByConsole(providers().get(providerID)),
    /** A paid model OpenCode Console serves without any limit on it. */
    unlimited: (model: ModelInfo) =>
      Boolean(info()) &&
      servedByConsole(providers().get(model.providerID)) &&
      !model.cost.every((cost) => cost.input === 0) &&
      usage(model) === undefined,
  }
}

/** How a model's limits read where they are short on space: nothing while there's plenty left. */
export function limitLabel(usage: ModelUsage | undefined, model: ModelInfo, language = createLanguage(() => "en")) {
  if (!usage) return undefined
  const level = usageLevel(usage, model)
  if (level === "plenty") return undefined
  if (level === "reached") return { text: language.t("tui.usage.limitReached"), danger: true }
  return {
    text: language.t("tui.usage.left", { amount: formatDollars(usage.left, language) }),
    danger: level === "out",
  }
}

/** `/usage`: the models the workspace limits, with what each has left. */
export function DialogUsage() {
  const language = useLanguage()
  const limits = useUsageLimits()
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  onMount(() => limits.load(true))
  const key = (model: ModelInfo) => `${model.providerID}/${model.id}`
  const rows = createMemo(() =>
    limits
      .models()
      .flatMap((model) => {
        const usage = limits.usage(model)
        return usage ? [{ model, usage, level: usageLevel(usage, model) }] : []
      })
      .toSorted((a, b) => a.model.name.localeCompare(b.model.name)),
  )
  // Spend shared between models would look counted twice on every row, so only the selected one shows it.
  const [active, setActive] = createSignal<string>()
  const selected = () => active() ?? (rows()[0] ? key(rows()[0].model) : undefined)
  const resets = () => Math.min(...rows().map((row) => row.usage.resetsAt))

  return (
    <Switch>
      <Match when={limits.info()}>
        {(info) => (
          <DialogSelect
            title={language.t("tui.interface.usage")}
            description={[
              info().workspace.name
                ? language.t("tui.usage.workspace", { name: info().workspace.name ?? "" })
                : undefined,
              rows().length > 0 ? language.t("tui.usage.resets", { time: formatReset(resets(), language) }) : undefined,
            ]
              .filter(Boolean)
              .join(" · ")}
            placeholder={language.t("tui.interface.searchModels")}
            options={rows().map((row) => ({
              title: row.model.name,
              value: key(row.model),
              footer:
                selected() === key(row.model)
                  ? language.t("tui.usage.left", { amount: formatDollars(row.usage.left, language) })
                  : undefined,
              footerColor: row.level === "out" || row.level === "reached" ? theme.text.feedback.error.base : undefined,
              onSelect: () => dialog.replace(() => <DialogUsageModel model={row.model} />),
            }))}
            onMove={(option) => setActive(option.value)}
            emptyView={
              <box paddingLeft={DIALOG_LIST_INSET} paddingRight={DIALOG_LIST_INSET}>
                <text fg={theme.text.muted} wrapMode="word">
                  {language.t("tui.interface.noLimitsApplyToYourModelsPaidModels")}
                </text>
              </box>
            }
          />
        )}
      </Match>
      <Match when={limits.info() === null}>
        <DialogLayout header={<DialogHeader title={language.t("tui.interface.usage")} />}>
          <text fg={theme.text.muted} wrapMode="word">
            {language.t("tui.interface.signInToOpencodeConsoleWithConnectTo")}
          </text>
        </DialogLayout>
      </Match>
      <Match when={true}>
        <DialogLayout header={<DialogHeader title={language.t("tui.interface.usage")} />}>
          <text fg={theme.text.muted}>{language.t("tui.interface.loading")}</text>
        </DialogLayout>
      </Match>
    </Switch>
  )
}

/** Every limit on one model, the one setting what's left marked. */
export function DialogUsageModel(props: { model: ModelInfo }) {
  const language = useLanguage()
  const limits = useUsageLimits()
  const theme = useTheme().surface("dialog")
  const usage = () => limits.usage(props.model)
  const short = () => {
    const value = usage()
    if (!value) return false
    const level = usageLevel(value, props.model)
    return level === "out" || level === "reached"
  }
  const workspace = () => limits.info()?.workspace.name

  return (
    <DialogLayout
      header={
        <DialogHeader
          titleView={
            <text fg={theme.text.base}>
              <span style={{ fg: theme.text.muted }}>{language.t("tui.interface.usage2")} </span>
              {props.model.name}
            </text>
          }
        />
      }
    >
      <Show
        when={usage()}
        fallback={
          <text fg={theme.text.muted}>{language.t("tui.usage.noModelLimits", { model: props.model.name })}</text>
        }
      >
        {(value) => (
          <box gap={1}>
            <box>
              <text fg={short() ? theme.text.feedback.error.base : theme.text.base} attributes={TextAttributes.BOLD}>
                {language.t("tui.usage.remaining", { amount: formatDollars(value().left, language) })}
              </text>
              <text fg={theme.text.muted}>
                {language.t("tui.usage.resets", { time: formatReset(value().resetsAt, language) })}
              </text>
            </box>
            <box>
              <text fg={theme.text.muted}>{language.t("tui.interface.limits")}</text>
              <For each={value().limits}>
                {(item, index) => (
                  <box>
                    <text fg={theme.text.base}>
                      <span
                        style={{
                          fg:
                            index() > 0
                              ? theme.text.muted
                              : value().reached
                                ? theme.text.feedback.error.base
                                : theme.text.feedback.warning.base,
                        }}
                      >
                        {index() === 0 ? "•" : "-"}{" "}
                      </span>
                      {language.t("tui.usage.spent", {
                        spent: formatDollars(item.spent, language),
                        limit: formatDollars(item.budget.limit, language),
                      })}
                    </text>
                    <box paddingLeft={2}>
                      <text fg={theme.text.muted} wrapMode="word">
                        {limitScope(item.budget, workspace(), language)}
                      </text>
                    </box>
                  </box>
                )}
              </For>
            </box>
          </box>
        )}
      </Show>
    </DialogLayout>
  )
}

// Each warning shows once per model while OpenCode runs, however many sessions use the model.
const warned = new Set<string>()

/** Reloads limits as the session's turns end, and warns once as the selected model runs low and once at its limit. */
export function useUsageAlerts(sessionID: () => string) {
  const language = useLanguage()
  const data = useData()
  const local = useLocal()
  const toast = useToast()
  const keymap = Keymap.use()
  const limits = useUsageLimits()
  onCleanup(
    data.on("session.execution.succeeded", (event) => {
      if (event.data.sessionID === sessionID() && limits.info()) limits.load(true)
    }),
  )
  createEffect(() => {
    const selected = local.model.current()
    const model = limits
      .models()
      .find((item) => item.providerID === selected?.providerID && item.id === selected?.modelID)
    const usage = model && limits.usage(model)
    if (!model || !usage) return
    const level = usageLevel(usage, model)
    if (level === "plenty") return
    const key = `${model.providerID}/${model.id}:${level === "reached" ? "reached" : "low"}`
    if (warned.has(key)) return
    warned.add(key)
    if (level === "reached") {
      toast.show({
        title: language.t("tui.usage.modelLimitReached", { model: model.name }),
        message: language.t("tui.usage.resets", { time: formatReset(usage.resetsAt, language) }),
        variant: "error",
        action: { label: language.t("tui.switchModel"), run: () => keymap.dispatch("model.list") },
      })
      return
    }
    toast.show({
      title: language.t("tui.usage.modelRunningLow", { model: model.name }),
      message: language.t("tui.usage.leftResets", {
        amount: formatDollars(usage.left, language),
        time: formatReset(usage.resetsAt, language),
      }),
      variant: "warning",
      action: { label: language.t("tui.interface.viewUsage"), run: () => keymap.dispatch("usage.show") },
    })
  })
}

/** Why a turn stopped at a usage limit or for lack of credits, and how to keep going; nothing for other errors. */
export function useLimitNotice(message: () => SessionMessageAssistant) {
  const language = useLanguage()
  const limits = useUsageLimits()
  const shortcut = Keymap.useShortcut("model.list")
  return createMemo(() => {
    const value = message()
    const error = value.error
    if (!error) return
    const reset = refusalReset(error) ?? retryReset(error, value.time.completed ?? value.time.created)
    const resets =
      reset === undefined ? "" : language.t("tui.usage.resets", { time: formatReset(reset, language) }) + ". "
    const name =
      limits.models().find((item) => item.providerID === value.model.providerID && item.id === value.model.id)?.name ??
      value.model.id
    if (error.type === "provider.go-limit")
      return {
        title: language.t("tui.usage.goLimitReached", { limit: goLimitName(error) ?? "" }).trim(),
        body: resets + language.t("tui.usage.switchFreeWith"),
        key: shortcut() ?? "/models",
        link: { label: language.t("tui.interface.orTurnOnExtraUsageOnYourGo"), href: goLimitLink(error) },
      }
    if (error.type === "provider.model-budget-limit")
      return {
        title: language.t("tui.usage.modelLimitReached", { model: name }),
        body: resets + language.t("tui.usage.switchWith"),
        key: shortcut() ?? "/models",
      }
    if (error.type === "provider.budget-limit")
      return {
        title: language.t("tui.interface.usageLimitReached"),
        body: resets + language.t("tui.usage.paidPaused"),
        key: shortcut() ?? "/models",
      }
    if (error.status === 402 && limits.served(value.model.providerID))
      return {
        title: language.t("tui.usage.noCredits", {
          workspace: limits.info()?.workspace.name ?? language.t("tui.usage.yourWorkspace"),
        }),
        body: language.t("tui.usage.waitForCredits"),
      }
    return undefined
  })
}

export function UsageLimitNotice(props: {
  notice: { title: string; body: string; key?: string; link?: { label: string; href: string } }
}) {
  const language = useLanguage()
  const theme = useTheme()
  return (
    <box
      marginLeft={2}
      border={["left"]}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={theme.border.base}
      paddingLeft={1}
      paddingTop={1}
      paddingBottom={1}
    >
      <text fg={theme.text.base}>{props.notice.title}</text>
      <text fg={theme.text.muted} wrapMode="word">
        {props.notice.body}
        <Show when={props.notice.key}>
          {(key) => (
            <>
              {" "}
              <span style={{ fg: theme.text.base }}>{key()}</span> {language.t("tui.usage.toContinue")}
            </>
          )}
        </Show>
      </text>
      <Show when={props.notice.link}>
        {(link) => (
          <box paddingTop={1}>
            <text fg={theme.text.muted} wrapMode="word">
              {link().label}
            </text>
            <Link href={link().href} fg={theme.text.base} />
          </box>
        )}
      </Show>
    </box>
  )
}
