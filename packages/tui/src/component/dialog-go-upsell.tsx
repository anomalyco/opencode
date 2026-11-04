import { RGBA, TextAttributes, type Renderable } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import type { FormAnswer, IntegrationOauthConnectOutput, IntegrationOAuthMethod } from "@opencode/client"
import * as Open from "@opencode/util/open"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { useConfig, useNewDesigns } from "../config"
import { useClient } from "../context/client"
import { useClipboard } from "../context/clipboard"
import { useData } from "../context/data"
import { Keymap } from "../context/keymap"
import { useLocal } from "../context/local"
import { useLocation } from "../context/location"
import { useTheme } from "../context/theme"
import { tint } from "../theme/color"
import { DialogFooter, DialogHeader, DialogLayout, useDialog } from "../ui/dialog"
import { Link } from "../ui/link"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"
import { credentialConnections } from "./dialog-integration"
import { DialogModel } from "./dialog-model"
import "./go-upsell-art"

export const GO_URL = "https://opencode.ai/go"
const ACTIONS = ["don't show again", "dismiss", "subscribe"] as const
type Action = (typeof ACTIONS)[number]
type IntegrationAttempt = IntegrationOauthConnectOutput["data"]
const OAUTH_CODE = /[A-Z0-9]{4}-[A-Z0-9]{4,5}/

let inflightConnect: Promise<void> = Promise.resolve()
function trackConnect(task: Promise<void>) {
  const next = task.catch(() => undefined)
  inflightConnect = inflightConnect.then(() => next)
}

export function waitForGoUpsellConnect() {
  return inflightConnect
}

export function DialogGoUpsell(props: {
  reset?: string
  canContinue?: () => boolean
  onSubscribe: () => void
  onDontShowAgain: () => void
}) {
  const dialog = useDialog()
  const dimensions = useTerminalDimensions()
  const theme = useTheme().surface("dialog")
  const config = useConfig().data
  const renderer = useRenderer()
  const narrow = () => dimensions().width < 52
  const short = () => dimensions().height < 22
  const compact = () => short() || dimensions().height < (narrow() ? 26 : 22)
  const animate = () => (config.animations ?? true) && !compact()
  const [selected, setSelected] = createSignal<Action>("subscribe")
  const [anchor, setAnchor] = createSignal<Renderable>()
  // Text sits on a translucent panel so the rings stay legible behind it.
  const textBg = () => {
    const [r, g, b] = theme.background.base.toInts()
    return RGBA.fromInts(r, g, b, 186)
  }
  const primary = () => theme.background.action.primary.focused

  createEffect(() => {
    if (!short()) return
    dialog.setCentered(true)
    onCleanup(() => {
      if (dialog.stack.length > 0) dialog.setCentered(false)
    })
  })

  // Every cell changes each frame, so hold the renderer to 30 fps while the art plays.
  createEffect(() => {
    if (!animate()) return
    const fps = { target: renderer.targetFps, max: renderer.maxFps }
    renderer.targetFps = 30
    renderer.maxFps = 30
    onCleanup(() => {
      renderer.targetFps = fps.target
      renderer.maxFps = fps.max
    })
  })

  const run = (action: Action) => {
    if (action === "subscribe") {
      Open.openUrl(GO_URL).catch(() => {})
      dialog.replace(() => <DialogGoUpsellConnect canContinue={props.canContinue} onSubscribed={props.onSubscribe} />)
      return
    }
    if (action === "don't show again") props.onDontShowAgain()
    dialog.clear()
  }
  const step = (by: number) =>
    setSelected((value) => ACTIONS[(ACTIONS.indexOf(value) + by + ACTIONS.length) % ACTIONS.length]!)

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "return", title: "Confirm Go option", group: "Dialog", run: () => run(selected()) },
      { bind: "left", title: "Previous Go option", group: "Dialog", run: () => step(-1) },
      { bind: "up", title: "Previous Go option", group: "Dialog", run: () => step(-1) },
      { bind: "shift+tab", title: "Previous Go option", group: "Dialog", run: () => step(-1) },
      { bind: "right", title: "Next Go option", group: "Dialog", run: () => step(1) },
      { bind: "down", title: "Next Go option", group: "Dialog", run: () => step(1) },
      { bind: "tab", title: "Next Go option", group: "Dialog", run: () => step(1) },
    ],
  }))

  const button = (action: Action) => (
    <box
      paddingLeft={2}
      paddingRight={2}
      backgroundColor={selected() === action ? primary() : RGBA.fromInts(0, 0, 0, 0)}
      onMouseOver={() => setSelected(action)}
      onMouseUp={() => run(action)}
    >
      <text
        fg={
          selected() === action
            ? theme.text.action.primary.focused
            : action === "subscribe"
              ? theme.text.base
              : theme.text.muted
        }
        bg={selected() === action ? undefined : textBg()}
        attributes={selected() === action ? TextAttributes.BOLD : undefined}
      >
        {action}
      </text>
    </box>
  )

  const inset = () => (narrow() ? 2 : 3)
  const bodyMaxHeight = () => {
    const topInset = short() ? 1 : Math.floor(dimensions().height / 4) + 1
    const footerRows = narrow() ? ACTIONS.length : 1
    const gaps = short() ? 1 : 4
    return Math.max(2, dimensions().height - topInset - footerRows - gaps)
  }

  return (
    <box>
      <Show when={!compact()}>
        <box position="absolute" top={-1} left={0} right={0} bottom={0} zIndex={0}>
          <go_upsell_art
            width="100%"
            height="100%"
            animate={animate()}
            background={theme.background.base}
            primary={primary()}
            logoBase={tint(theme.background.base, theme.text.base, 0.62)}
            logoAnchor={anchor()}
          />
        </box>
      </Show>
      <box zIndex={1} paddingLeft={inset()} paddingRight={inset()} paddingBottom={short() ? 0 : 1} gap={short() ? 0 : 1}>
        <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
          <text attributes={TextAttributes.BOLD} fg={theme.text.base} bg={textBg()}>
            Free limit reached
          </text>
          <text fg={theme.text.muted} bg={textBg()} onMouseUp={() => dialog.clear()}>
            esc
          </text>
        </box>
        <Show
          when={!compact()}
          fallback={
            <scrollbox maxHeight={bodyMaxHeight()} flexShrink={1}>
              <text fg={theme.text.muted} bg={textBg()} wrapMode="word">
                You've used today's free messages.{props.reset ? ` Resets at ${props.reset}.` : ""}
              </text>
              <text fg={theme.text.muted} bg={textBg()} wrapMode="word">
                OpenCode Go gives you reliable access to the best open-source models for $10/month.
              </text>
              <Link href={GO_URL} fg={primary()} bg={textBg()} wrapMode="none" />
            </scrollbox>
          }
        >
          <box>
            <text fg={theme.text.muted} bg={textBg()} wrapMode="word">
              You've used today's free messages.{props.reset ? ` Resets at ${props.reset}.` : ""}
            </text>
            <text fg={theme.text.muted} bg={textBg()} wrapMode="word">
              OpenCode Go gives you reliable access to the best open-source models for $10/month.
            </text>
          </box>
          <box ref={setAnchor} height={7} paddingBottom={1} alignItems="center" justifyContent="flex-end">
            <Link href={GO_URL} fg={primary()} bg={textBg()} wrapMode="none" />
          </box>
        </Show>
        <Show
          when={!narrow()}
          fallback={
            <box flexDirection="column" alignItems="flex-start" flexShrink={0}>
              <For each={ACTIONS}>{(action) => button(action)}</For>
            </box>
          }
        >
          <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
            {button("don't show again")}
            <box flexDirection="row" gap={1}>
              <For each={["dismiss", "subscribe"] as const}>{(action) => button(action)}</For>
            </box>
          </box>
        </Show>
      </box>
    </box>
  )
}

function DialogGoUpsellConnect(props: { canContinue?: () => boolean; onSubscribed: () => void }) {
  const data = useData()
  const currentLocation = useLocation()
  const location = currentLocation.ref ?? data.location.default()
  const dialog = useDialog()
  const client = useClient()
  const toast = useToast()
  const clipboard = useClipboard()
  const local = useLocal()
  const newDesigns = useNewDesigns()
  const theme = useTheme().surface("dialog")
  const [attempt, setAttempt] = createSignal<IntegrationAttempt>()
  const integration = createMemo(() => data.location.integration.list(location)?.find((item) => item.id === "opencode"))
  const method = createMemo(() =>
    integration()?.methods.find((item): item is IntegrationOAuthMethod => item.type === "oauth" && item.id === "device"),
  )

  let started = false
  let settled = false
  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let pendingAttemptID: string | undefined

  const valid = () => {
    const current = data.location.integration.list(location)?.find((item) => item.id === "opencode")
    const active = current ? credentialConnections(current)[0] : undefined
    return Boolean(active && !active.status)
  }

  const finish = () => {
    if (props.canContinue && !props.canContinue()) {
      dialog.clear()
      return
    }
    const goModel = (data.location.model.list(location) ?? []).find(
      (item) => item.providerID === "opencode-go" && item.status !== "deprecated",
    )
    if (goModel) {
      local.model.set({ providerID: goModel.providerID, modelID: goModel.id }, { recent: true })
      dialog.clear()
      props.onSubscribed()
      return
    }
    dialog.replace(() => <DialogModel />)
  }

  const sync = async (announce: boolean) => {
    data.location.integration.invalidate(location)
    data.location.model.invalidate(location)
    data.location.provider.invalidate(location)
    try {
      await Promise.all([
        data.location.integration.sync(location),
        data.location.model.sync(location),
        data.location.provider.sync(location),
      ])
    } catch (cause) {
      if (closed || dialog.stack.length === 0) return false
      toast.show({ variant: "error", message: errorMessage(cause) })
      dialog.clear()
      return false
    }
    if (closed || dialog.stack.length === 0) return false
    if (!valid()) return null
    if (announce) {
      toast.show({ variant: "success", message: `Connected ${integration()?.name ?? "OpenCode Console"}` })
    }
    finish()
    return true
  }

  const poll = (current: IntegrationAttempt) => {
    trackConnect(
      (async () => {
        try {
          const result = await client.api.integration.oauth.status({
            integrationID: "opencode",
            attemptID: current.attemptID,
            location: { directory: location.directory },
          })
          if (closed) return
          const status = result.data
          if (status.status === "pending") {
            timer = setTimeout(() => poll(current), 500)
            return
          }
          settled = true
          if (status.status === "complete") {
            const ok = await sync(true)
            if (ok === null && !closed) dialog.clear()
            return
          }
          toast.show({
            variant: "error",
            message: status.status === "failed" ? status.message : "Authorization expired",
          })
          dialog.clear()
        } catch (cause) {
          if (closed) return
          settled = true
          toast.show({ variant: "error", message: errorMessage(cause) })
          dialog.clear()
        }
      })(),
    )
  }

  const startOAuth = (oauthMethod: IntegrationOAuthMethod) => {
    const answer: FormAnswer = {}
    for (const field of oauthMethod.form ?? []) {
      if (field.type !== "external" && field.default !== undefined) {
        answer[field.key] = field.default
      }
    }
    trackConnect(
      (async () => {
        try {
          const base = {
            integrationID: "opencode",
            location: { directory: location.directory },
            methodID: oauthMethod.id,
          }
          const result = await client.api.integration.oauth.connect(
            Object.keys(answer).length > 0 ? { ...base, answer } : base,
          )
          if (closed) {
            void client.api.integration.oauth.cancel({
              integrationID: "opencode",
              attemptID: result.data.attemptID,
              location: { directory: location.directory },
            })
            return
          }
          pendingAttemptID = result.data.attemptID
          setAttempt(result.data)
          poll(result.data)
        } catch (cause) {
          if (closed) return
          toast.show({ variant: "error", message: errorMessage(cause) })
          dialog.clear()
        }
      })(),
    )
  }

  createEffect(() => {
    if (started || closed) return
    const current = integration()
    const oauthMethod = method()
    if (!current || !oauthMethod) return
    started = true
    if (valid()) {
      trackConnect(
        (async () => {
          const ok = await sync(false)
          if (ok === null && !closed) startOAuth(oauthMethod)
        })(),
      )
      return
    }
    startOAuth(oauthMethod)
  })

  onCleanup(() => {
    closed = true
    if (timer) clearTimeout(timer)
    if (settled || !pendingAttemptID) return
    void client.api.integration.oauth.cancel({
      integrationID: "opencode",
      attemptID: pendingAttemptID,
      location: { directory: location.directory },
    })
  })

  const open = () => {
    const current = attempt()
    if (!current) return
    Open.openUrl(current.url).catch(() =>
      toast.show({
        message: "Could not open the browser. Copy the URL and continue manually.",
        variant: "error",
      }),
    )
  }

  const copy = () => {
    const current = attempt()
    if (!current) return
    const value = current.instructions.match(OAUTH_CODE)?.[0] ?? current.url
    clipboard
      .write(value)
      .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
      .catch(toast.error)
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    enabled: () => Boolean(attempt()),
    commands: [
      { bind: newDesigns() ? "return" : "o", title: "Open authorization URL", group: "Dialog", run: open },
      { bind: "c", title: "Copy authorization details", group: "Dialog", run: copy },
    ],
  }))

  const title = () => method()?.label ?? "Connect an integration"

  return (
    <DialogLayout
      header={<DialogHeader title={title()} />}
      footer={{
        actions: {
          primary: attempt()
            ? [
                {
                  title: attempt()?.instructions.match(OAUTH_CODE) ? "copy code" : "copy link",
                  key: "c",
                  onTrigger: copy,
                },
                { title: "open link", key: "enter", onTrigger: open },
              ]
            : [],
        },
      }}
      legacyFooter={
        <DialogFooter
          actions={{
            secondary: attempt()
              ? [
                  { title: "open", key: "o" },
                  { title: "copy", key: "c" },
                ]
              : [],
          }}
        />
      }
    >
      <box gap={1}>
        <Show when={attempt()}>
          {(current) => (
            <box gap={1}>
              <Link href={current().url} fg={theme.markdown.link} />
              <Show when={current().instructions}>
                {(instructions) => <text fg={theme.text.muted}>{instructions()}</text>}
              </Show>
            </box>
          )}
        </Show>
        <text fg={theme.text.muted}>{attempt() ? "Waiting for authorization…" : "Starting authorization…"}</text>
      </box>
    </DialogLayout>
  )
}
