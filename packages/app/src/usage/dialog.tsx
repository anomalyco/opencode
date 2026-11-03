import type { LocationRef, UsageLimitsInfo } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Loader } from "@opencode/ui/loader"
import { createStore } from "solid-js/store"
import { For, type JSX, Match, onMount, Show, Switch } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useData } from "@/runtime/server/current"
import { useUsageFormat } from "./format"
import {
  type BudgetLabel,
  type BudgetNote,
  type BudgetRow,
  type Callout,
  type CurrentModel,
  type GoRow,
  type LimitAction,
  usageView,
} from "./limits"
import "./dialog.css"

/** The Usage dialog: the location's OpenCode Go allowance and Console budgets, refreshed when it opens. */
export function DialogUsage(props: {
  location: LocationRef
  /** The model in use, so a per-model budget shows this model's counter. */
  model?: CurrentModel
  /** The last request was refused because the workspace is out of credits. */
  credits?: boolean
  onSwitchModel?: () => void
}) {
  const data = useData()
  const language = useLanguage()
  const [state, setState] = createStore({ loading: true, failed: false })
  const load = () => {
    setState({ loading: true, failed: false })
    data.location.usage.invalidate(props.location)
    data.location.usage
      .sync(props.location)
      .then(() => setState({ loading: false, failed: false }))
      .catch(() => setState({ loading: false, failed: true }))
  }
  onMount(load)
  const info = () => data.location.usage.limits(props.location)

  return (
    <Switch>
      <Match when={info()}>
        {(value) => (
          <UsageDialogContent
            info={value()}
            model={props.model}
            credits={props.credits}
            onSwitchModel={props.onSwitchModel}
          />
        )}
      </Match>
      <Match when={true}>
        <UsageFrame>
          <div class="flex min-h-[120px] items-center justify-center px-4 pb-4">
            <Switch>
              <Match when={state.loading}>
                <Loader />
              </Match>
              <Match when={state.failed}>
                <div class="flex flex-col items-center gap-3">
                  <span class="text-[13px] leading-text-compact font-[440] tracking-[-0.04px] text-v2-text-text-muted">
                    {language.t("usage.error")}
                  </span>
                  <Button variant="neutral" onClick={load}>
                    {language.t("usage.retry")}
                  </Button>
                </div>
              </Match>
              <Match when={true}>
                <Panel gap={8}>
                  <Item>
                    <Line class="font-[530] text-v2-text-text-base">{language.t("usage.signedOut.title")}</Line>
                    <Line class="text-v2-text-text-muted">{language.t("usage.signedOut.body")}</Line>
                  </Item>
                </Panel>
              </Match>
            </Switch>
          </div>
        </UsageFrame>
      </Match>
    </Switch>
  )
}

/** The dialog for usage limits already loaded. */
export function UsageDialogContent(props: {
  info: UsageLimitsInfo
  model?: CurrentModel
  credits?: boolean
  onSwitchModel?: () => void
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const format = useUsageFormat()
  const view = () => usageView(props.info, { model: props.model, credits: props.credits })
  const workspace = () => view().workspace ?? language.t("usage.workspace.fallback")
  const vendors = (list: readonly string[]) =>
    new Intl.ListFormat(language.intl(), { style: "long", type: "conjunction" }).format(list)
  const duration = (until: number) => {
    const minutes = Math.max(1, Math.floor((until - Date.now()) / 60_000))
    if (minutes >= 1_440)
      return language.t("usage.duration.days", {
        days: Math.floor(minutes / 1_440),
        hours: Math.floor((minutes % 1_440) / 60),
      })
    if (minutes >= 60)
      return language.t("usage.duration.hours", { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
    return language.t("usage.duration.minutes", { minutes })
  }
  const label = (value: BudgetLabel): string => {
    if (value.kind === "all") return language.t("usage.budget.all")
    if (value.kind === "each") return language.t("usage.budget.each")
    if (value.kind === "vendors") {
      const params = {
        vendors: vendors(value.vendors),
        price: value.price === undefined ? "" : format.money(value.price, "auto"),
      }
      if (value.price !== undefined)
        return language.t(value.each ? "usage.budget.vendorsPriceEach" : "usage.budget.vendorsPrice", params)
      return language.t(value.each ? "usage.budget.vendorsEach" : "usage.budget.vendors", params)
    }
    if (value.kind === "price")
      return language.t(value.each ? "usage.budget.priceEach" : "usage.budget.price", {
        price: format.money(value.price, "auto"),
      })
    const models =
      value.names.length > 2
        ? language.plural("usage.budget.modelsMore", value.names.length - 2, {
            first: value.names[0],
            second: value.names[1],
          })
        : vendors(value.names)
    return value.each ? language.t("usage.budget.modelsEach", { models }) : models
  }
  const scope = (row: BudgetRow) => {
    const params = { limit: format.money(row.limit, "auto"), workspace: workspace() }
    const amount = {
      you: row.perModel ? "usage.budget.youEach" : "usage.budget.you",
      everyone: row.perModel ? "usage.budget.everyoneEach" : "usage.budget.everyone",
      group: row.perModel ? "usage.budget.groupEach" : "usage.budget.group",
    } as const
    return [language.t(amount[row.sharing], params), ...row.notes.map((value) => note(value, row))].join(" · ")
  }
  const note = (value: BudgetNote, row: BudgetRow) => {
    if (value.kind === "runs-out-first") return language.t("usage.note.runsOutFirst")
    if (value.kind === "paused") return language.t("usage.note.paused", { label: label(row.label) })
    if (value.kind === "includes-web-search") return language.t("usage.note.webSearch")
    if (value.kind === "paused-by")
      return language.t(value.shared ? "usage.note.pausedByWorkspace" : "usage.note.pausedByBudget")
    return language.t("usage.note.currentModel", { model: value.name })
  }
  const footer = () => {
    const value = view().footer
    if (value.kind === "credits-only") return language.t("usage.footer.creditsOnly", { workspace: workspace() })
    return language.t(value.kind === "budgets-reset" ? "usage.footer.budgetsReset" : "usage.footer.resets", {
      time: format.time(value.resetsAt),
    })
  }
  const callout = (value: Callout) => {
    if (value.kind === "credits")
      return {
        title: language.t("usage.callout.credits.title", { workspace: workspace() }),
        body: language.t("usage.callout.credits.body"),
      }
    const params = { workspace: workspace(), time: format.time(value.resetsAt) }
    if (value.kind === "workspace")
      return {
        title: language.t("usage.callout.workspace.title"),
        body: language.t("usage.callout.workspace.body", params),
      }
    return {
      title: language.t("usage.callout.personal.title"),
      body: language.t("usage.callout.personal.body", params),
    }
  }
  const action = (value: LimitAction) => {
    if (value.kind === "other-models")
      return {
        title: language.t("usage.action.otherModels.title"),
        body:
          value.vendors.length > 0
            ? language.t("usage.action.otherModels.vendors", { vendors: vendors(value.vendors) })
            : language.t("usage.action.otherModels.body"),
      }
    const limit = format.money(value.limit, "auto")
    return {
      title:
        value.vendors.length > 0
          ? language.t("usage.action.each.titleVendors", { vendors: vendors(value.vendors) })
          : language.t("usage.action.each.title"),
      body: value.suggestion
        ? language.t("usage.action.each.suggestion", {
            limit,
            model: value.suggestion.name,
            left: format.money(value.suggestion.left),
          })
        : language.t("usage.action.each.body", { limit }),
    }
  }
  const switchModel = () => {
    dialog.close()
    props.onSwitchModel?.()
  }

  return (
    <UsageFrame
      footer={
        <>
          <span class="flex h-7 min-w-0 flex-1 items-center">
            <Line class="text-v2-text-text-faint">{footer()}</Line>
          </span>
          <Button
            variant="ghost"
            class="text-v2-text-text-muted!"
            onClick={() => platform.openExternal(props.info.workspace.usageURL)}
          >
            {language.t("usage.footer.details")}
          </Button>
        </>
      }
    >
      <Show when={view().callout}>
        {(value) => (
          <div data-slot="usage-callout" class="flex items-stretch gap-0.5 px-4">
            <div class="w-0.5 shrink-0 bg-v2-state-fg-danger" />
            <div class="flex flex-1 flex-col gap-1.5 rounded-r-md bg-v2-state-bg-danger p-3">
              <Line class="font-[530] text-[var(--usage-reached)]">{callout(value()).title}</Line>
              <p class="m-0 text-[13px] leading-text-base font-[440] tracking-[-0.04px] text-[var(--usage-reached)]">
                {callout(value()).body}
              </p>
            </div>
          </div>
        )}
      </Show>
      <Show when={view().go}>
        {(rows) => (
          <Section label={language.t("usage.section.go")}>
            <Panel>
              <For each={rows()}>
                {(row, index) => (
                  <>
                    <Show when={index() > 0}>
                      <Divider />
                    </Show>
                    <GoItem row={row} used={language.t("usage.go.used", { percent: Math.round(row.percent) })}>
                      {language.t("usage.go.resetsIn", { duration: duration(row.resetsAt) })}
                    </GoItem>
                  </>
                )}
              </For>
            </Panel>
          </Section>
        )}
      </Show>
      <Section label={language.t("usage.section.console")} badge={view().workspace} dimmed={view().dimmed}>
        <Show
          when={view().budgets.length > 0}
          fallback={
            <Panel gap={8}>
              <Item>
                <Line class="font-[530] text-v2-text-text-base">{language.t("usage.empty.title")}</Line>
                <Line class="text-v2-text-text-muted">
                  {language.t("usage.empty.body", { workspace: workspace() })}
                </Line>
              </Item>
            </Panel>
          }
        >
          <Panel>
            <For each={view().budgets}>
              {(row, index) => (
                <>
                  <Show when={index() > 0}>
                    <Divider />
                  </Show>
                  <Item>
                    <div class="flex items-start justify-between self-stretch">
                      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                        <Line class="font-[530] text-v2-text-text-base">{label(row.label)}</Line>
                        <p class="m-0 text-[13px] leading-text-compact font-[440] tracking-[-0.04px] text-v2-text-text-muted">
                          {scope(row)}
                        </p>
                      </div>
                      <Spend
                        status={
                          row.reached
                            ? language.t("usage.budget.reached")
                            : language.t("usage.budget.left", { amount: format.money(row.left) })
                        }
                        reached={row.reached}
                      >
                        {row.reached
                          ? language.t("usage.budget.spentOf", {
                              spent: format.money(row.spent),
                              limit: format.money(row.limit, "auto"),
                            })
                          : language.t("usage.budget.of", { limit: format.money(row.limit, "auto") })}
                      </Spend>
                    </div>
                    <Track fill={row.fill} reached={row.reached} />
                  </Item>
                </>
              )}
            </For>
            <Show when={view().action}>
              {(value) => (
                <div class="flex items-center gap-4 self-stretch px-4">
                  <div class="flex min-w-0 flex-1 flex-col gap-1">
                    <Line class="font-[530] text-v2-text-text-base">{action(value()).title}</Line>
                    <p class="m-0 text-[13px] leading-text-base font-[440] tracking-[-0.04px] text-v2-text-text-muted">
                      {action(value()).body}
                    </p>
                  </div>
                  <Button variant="neutral" onClick={switchModel}>
                    {language.t("usage.action.switch")}
                  </Button>
                </div>
              )}
            </Show>
          </Panel>
        </Show>
      </Section>
    </UsageFrame>
  )
}

function UsageFrame(props: { children: JSX.Element; footer?: JSX.Element }) {
  const language = useLanguage()
  return (
    <Dialog fit containerClass="w-[min(calc(100vw-32px),512px)]!">
      <div data-component="usage-dialog" class="flex flex-col self-stretch">
        <DialogHeader>
          <DialogTitleGroup title={language.t("usage.title")} />
        </DialogHeader>
        <DialogBody>
          <div class="flex flex-col gap-4">{props.children}</div>
        </DialogBody>
        <Show when={props.footer}>
          <DialogFooter>{props.footer}</DialogFooter>
        </Show>
      </div>
    </Dialog>
  )
}

function Section(props: { label: string; badge?: string; dimmed?: boolean; children: JSX.Element }) {
  return (
    <div class="flex flex-col gap-3" classList={{ "opacity-60": props.dimmed }}>
      <div class="flex items-center gap-2 pr-5 pl-4">
        <Line class="text-v2-text-text-muted">{props.label}</Line>
        <Show when={props.badge}>
          {(badge) => (
            <span class="flex h-4 items-center rounded-[2px] bg-v2-background-bg-layer-03 px-1 text-[11px] leading-text-tight font-[530] tracking-[0.05px] text-v2-text-text-muted">
              {badge()}
            </span>
          )}
        </Show>
      </div>
      <div class="flex flex-col px-3">{props.children}</div>
    </div>
  )
}

function Panel(props: { gap?: 8 | 16; children: JSX.Element }) {
  return (
    <div
      class="flex flex-col self-stretch rounded-lg border-[0.5px] border-v2-border-border-base bg-v2-background-bg-base py-4"
      classList={{ "gap-2": props.gap === 8, "gap-4": props.gap !== 8 }}
    >
      {props.children}
    </div>
  )
}

function Item(props: { children: JSX.Element }) {
  return <div class="flex flex-col gap-4 self-stretch px-4">{props.children}</div>
}

function Divider() {
  return <div class="h-[0.5px] shrink-0 self-stretch bg-v2-border-border-base" />
}

/** One line of 13px text that truncates rather than wraps. */
function Line(props: { class?: string; children: JSX.Element }) {
  return (
    <span
      class={`min-w-0 truncate text-[13px] leading-text-compact font-[440] tracking-[-0.04px] ${props.class ?? ""}`}
    >
      {props.children}
    </span>
  )
}

function GoItem(props: { row: GoRow; used: string; children: JSX.Element }) {
  const language = useLanguage()
  return (
    <Item>
      <div class="flex items-center justify-between self-stretch">
        <Line class="font-[530] text-v2-text-text-base">{language.t(`usage.go.${props.row.window}`)}</Line>
        <Spend status={props.used} reached={props.row.limited}>
          {props.children}
        </Spend>
      </div>
      <Track fill={props.row.percent / 100} reached={props.row.limited} />
    </Item>
  )
}

function Spend(props: { status: string; reached: boolean; children: JSX.Element }) {
  return (
    <div class="flex shrink-0 items-center gap-1.5">
      <Line
        class={`font-[530] tabular-nums ${props.reached ? "text-[var(--usage-reached)]" : "text-v2-text-text-base"}`}
      >
        {props.status}
      </Line>
      <svg width="3" height="3" viewBox="0 0 3 3" aria-hidden="true" class="shrink-0 text-v2-icon-icon-muted">
        <circle cx="1.5" cy="1.5" r="0.5625" fill="currentColor" />
      </svg>
      <Line class="text-v2-text-text-muted">{props.children}</Line>
    </div>
  )
}

function Track(props: { fill: number; reached: boolean }) {
  return (
    <div class="flex h-2 items-center self-stretch overflow-hidden rounded-[2px] bg-v2-background-bg-layer-03">
      <div
        class="h-2"
        classList={{ "bg-v2-background-bg-inverse": !props.reached, "bg-[var(--usage-reached)]": props.reached }}
        style={{ width: `${Math.max(0, Math.min(1, props.fill)) * 100}%` }}
      />
    </div>
  )
}
