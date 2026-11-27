import type { IntegrationInfo, UsageLimitsInfo, UsageLimitsMeter } from "@opencode/client/promise"
import { createMemo, createSignal, For, Match, Show, Switch, type Accessor } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createKeyed, usePlugin } from "@opencode/plugin/gui"
import type definition from "./index"

const GO_URL = "https://opencode.ai/go"

const DOCS_URL = "https://opencode.ai/v2/docs/console/go/"

const WINDOWS = ["rolling", "weekly", "monthly"] as const

/**
 * The parts of a server's `ServerRef` the page reads. The renderer passes the live ref, so `data` is read on every
 * call and follows a restarted server.
 */
export type GoServer = {
  readonly id: string
  readonly data: {
    readonly location: {
      readonly integration: {
        list(): readonly Pick<IntegrationInfo, "id" | "connections">[] | undefined
        sync(): Promise<void>
      }
      readonly usage: {
        limits(): UsageLimitsInfo | null | undefined
        sync(): Promise<void>
        invalidate(): void
      }
    }
  }
}

/** The OpenCode Go page: the subscription's usage limits, or how to subscribe. */
export default function GoPage(props: { server: Accessor<GoServer | undefined> }) {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui
  const system = ctx.system
  const [failed, setFailed] = createSignal(false)

  // Spend moves with every request and a plan changes in the browser, so the page loads fresh limits when it opens,
  // when the window regains focus and on retry, showing the server's cache meanwhile. Signing in or out, or switching
  // workspace, refreshes the cache by itself.
  const load = () => {
    const server = props.server()

    if (!server) return
    const location = server.data.location

    setFailed(false)
    location.usage.invalidate()
    void Promise.all([location.integration.sync(), location.usage.sync()]).catch(() => {
      if (props.server() === server) setFailed(true)
    })
  }

  createKeyed(props.server, load)
  makeEventListener(window, "focus", load)

  const limits = () => props.server()?.data.location.usage.limits()

  const signedIn = () =>
    props
      .server()
      ?.data.location.integration.list()
      ?.find((integration) => integration.id === "opencode")?.connections.length

  const status = createMemo(() => {
    if (limits()?.go) return "subscribed"

    if (signedIn() === 0) return "signed-out"

    if (signedIn() && limits() !== undefined) return "not-subscribed"

    if (failed()) return "failed"

    return "loading"
  })

  const duration = (until: number) => {
    const minutes = Math.max(1, Math.floor((until - Date.now()) / 60_000))

    if (minutes >= 1_440)
      return ctx.t("duration.days", { days: Math.floor(minutes / 1_440), hours: Math.floor((minutes % 1_440) / 60) })

    if (minutes >= 60) return ctx.t("duration.hours", { hours: Math.floor(minutes / 60), minutes: minutes % 60 })

    return ctx.t("duration.minutes", { minutes })
  }

  return (
    <ui.SettingsLayout
      title={ctx.t("title")}
      description={ctx.t("description")}
      actions={
        <ui.Button variant="ghost" icon="square-arrow-top-right" onClick={() => system.openExternal(DOCS_URL)}>
          {ctx.t("details")}
        </ui.Button>
      }
    >
      <Switch>
        <Match when={limits()?.go}>
          {(go) => (
            <>
              <ui.SettingsSection title={ctx.t("usage.title")}>
                <For each={WINDOWS}>
                  {(window) => <Meter label={ctx.t(`usage.${window}`)} meter={go()[window]} duration={duration} />}
                </For>
              </ui.SettingsSection>
              <ui.SettingsSection>
                <ui.SettingsRow title={ctx.t("manage.title")} description={ctx.t("manage.description")}>
                  <ui.Button variant="neutral" onClick={() => system.openExternal(limits()?.workspace.goURL ?? GO_URL)}>
                    {ctx.t("manage.action")}
                  </ui.Button>
                </ui.SettingsRow>
              </ui.SettingsSection>
            </>
          )}
        </Match>
        <Match when={status() === "loading"}>
          <div class="flex min-h-[120px] items-center justify-center">
            <ui.Loader />
          </div>
        </Match>
        <Match when={true}>
          <ui.SettingsSection
            footer={
              <Show when={status() === "failed"}>
                <div class="flex flex-wrap items-center gap-2 text-text-weak">
                  <p>{ctx.t("failed.description")}</p>
                  <ui.Button size="small" variant="ghost" onClick={load}>
                    {ctx.t("retry")}
                  </ui.Button>
                </div>
              </Show>
            }
          >
            <ui.SettingsRow title={ctx.t("subscribe.title")} description={ctx.t("subscribe.description")}>
              <ui.Button variant="submit" onClick={() => system.openExternal(limits()?.workspace.goURL ?? GO_URL)}>
                {ctx.t("subscribe.action")}
              </ui.Button>
            </ui.SettingsRow>
            <Show when={status() === "signed-out"}>
              <ui.SettingsRow title={ctx.t("signIn.title")} description={ctx.t("signIn.description")}>
                <ui.Button
                  variant="neutral"
                  onClick={() => {
                    const server = props.server()

                    if (server) ctx.layout.connect({ server: server.id, integration: "opencode" })
                  }}
                >
                  {ctx.t("signIn.action")}
                </ui.Button>
              </ui.SettingsRow>
            </Show>
          </ui.SettingsSection>
        </Match>
      </Switch>
    </ui.SettingsLayout>
  )
}

function Meter(props: { label: string; meter: UsageLimitsMeter; duration: (until: number) => string }) {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui
  const fill = () => Math.max(0, Math.min(100, props.meter.percent))

  return (
    <ui.SettingsRow
      title={props.label}
      description={ctx.t("usage.resetsIn", { duration: props.duration(props.meter.resetsAt) })}
    >
      <div class="flex w-48 flex-col items-end gap-1.5">
        <span
          class="text-[13px] leading-text-compact font-[530] tabular-nums"
          classList={{ "text-v2-state-fg-danger": props.meter.limited, "text-v2-text-text-base": !props.meter.limited }}
        >
          {props.meter.limited
            ? ctx.t("usage.limited")
            : ctx.t("usage.used", { percent: Math.round(props.meter.percent) })}
        </span>
        <div
          class="h-1.5 self-stretch overflow-hidden rounded-[2px] bg-v2-background-bg-layer-03"
          role="meter"
          aria-label={props.label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fill())}
        >
          <div
            class="h-full"
            classList={{
              "bg-v2-background-bg-inverse": !props.meter.limited,
              "bg-v2-state-fg-danger": props.meter.limited,
            }}
            style={{ width: `${fill()}%` }}
          />
        </div>
      </div>
    </ui.SettingsRow>
  )
}
