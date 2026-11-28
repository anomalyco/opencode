import type { UsageLimitsGoConnection, UsageLimitsMeter } from "@opencode/client/promise"
import { createSignal, For, Match, Show, Switch, type Accessor } from "solid-js"
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
      readonly usage: {
        readonly go: {
          info(): UsageLimitsGoConnection | null | undefined
          sync(): Promise<void>
          invalidate(): void
        }
      }
    }
  }
}

/** The OpenCode Go page: how Go is connected and its usage, or how to subscribe and connect it. */
export default function GoPage(props: { server: Accessor<GoServer | undefined> }) {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui
  const system = ctx.system
  const [failed, setFailed] = createSignal(false)

  // Spend moves with every request and a plan changes in the browser, so the page loads fresh usage when it opens,
  // when the window regains focus and on retry, showing the server's cache meanwhile. Connecting, disconnecting and
  // switching workspace refresh the cache by themselves.
  const load = () => {
    const server = props.server()

    if (!server) return
    const go = server.data.location.usage.go

    setFailed(false)
    go.invalidate()
    void go.sync().catch(() => {
      if (props.server() === server) setFailed(true)
    })
  }

  createKeyed(props.server, load)
  makeEventListener(window, "focus", load)

  // Null while nothing connects Go; undefined until the server answers.
  const go = () => props.server()?.data.location.usage.go.info()

  const description = () => {
    const value = go()

    if (!value) return ctx.t("description")

    if (value.connection === "key" || !value.workspace) return ctx.t("connected.key")

    return ctx.t("connected.account", { workspace: value.workspace.name ?? value.workspace.id })
  }

  // The two ways Go connects, as Settings › Providers offers them: the account's device sign-in, or a Go key.
  const connect = (label: string) => {
    const open = (integration: string, method: "oauth" | "key") => {
      const server = props.server()

      if (server) ctx.layout.connect({ server: server.id, integration, method })
    }

    return (
      <ui.Menu
        label={label}
        trigger="button"
        items={[
          { label: ctx.t("connect.account"), onSelect: () => open("opencode", "oauth") },
          { label: ctx.t("connect.key"), onSelect: () => open("opencode-go", "key") },
        ]}
      />
    )
  }

  // The workspace's own Go page; a key doesn't say which workspace it belongs to.
  const goURL = () => go()?.workspace?.goURL ?? GO_URL

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
      description={description()}
      actions={
        <ui.Button variant="ghost" icon="square-arrow-top-right" onClick={() => system.openExternal(DOCS_URL)}>
          {ctx.t("details")}
        </ui.Button>
      }
    >
      <Switch>
        <Match when={go()}>
          {(value) => (
            <Show
              when={value().usage}
              fallback={
                <ui.SettingsSection>
                  <ui.SettingsRow title={ctx.t("renew.title")} description={ctx.t("renew.description")}>
                    <div class="flex flex-wrap justify-end gap-2">
                      {connect(ctx.t("change"))}
                      <ui.Button variant="submit" onClick={() => system.openExternal(goURL())}>
                        {ctx.t("subscribe.action")}
                      </ui.Button>
                    </div>
                  </ui.SettingsRow>
                </ui.SettingsSection>
              }
            >
              {(usage) => (
                <>
                  <ui.SettingsSection title={ctx.t("usage.title")}>
                    <For each={WINDOWS}>
                      {(window) => (
                        <Meter label={ctx.t(`usage.${window}`)} meter={usage()[window]} duration={duration} />
                      )}
                    </For>
                  </ui.SettingsSection>
                  <ui.SettingsSection>
                    <ui.SettingsRow title={ctx.t("manage.title")} description={ctx.t("manage.description")}>
                      <div class="flex flex-wrap justify-end gap-2">
                        {connect(ctx.t("change"))}
                        <ui.Button variant="neutral" onClick={() => system.openExternal(goURL())}>
                          {ctx.t("manage.action")}
                        </ui.Button>
                      </div>
                    </ui.SettingsRow>
                  </ui.SettingsSection>
                </>
              )}
            </Show>
          )}
        </Match>
        <Match when={go() === undefined && !failed()}>
          <div class="flex min-h-[120px] items-center justify-center">
            <ui.Loader />
          </div>
        </Match>
        <Match when={true}>
          <ui.SettingsSection
            footer={
              <Show when={failed()}>
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
              <ui.Button variant="submit" onClick={() => system.openExternal(GO_URL)}>
                {ctx.t("subscribe.action")}
              </ui.Button>
            </ui.SettingsRow>
            <ui.SettingsRow title={ctx.t("connect.title")} description={ctx.t("connect.description")}>
              {connect(ctx.t("connect.action"))}
            </ui.SettingsRow>
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
