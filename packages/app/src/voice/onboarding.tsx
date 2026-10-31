import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogFooter, DialogTitle } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import type { IconName } from "@opencode/ui/icons/catalog"
import { Loader } from "@opencode/ui/loader"
import { ProviderIcon } from "@opencode/ui/provider-icon"
import { CloseButton } from "@kobalte/core/dialog"
import { For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import type { ServerCtx } from "@/runtime/server/runtime"
import { useLanguage } from "@/runtime/i18n/language"
import { VoiceScope } from "./scope"
import "./voice.css"

/** Whether this server can start GPT-Live calls, and on whose account. */
export type VoiceAccess =
  | { type: "checking" }
  | { type: "ready"; via: "console" | "openai" }
  | { type: "missing" }
  | { type: "unreachable" }

export type VoiceMicrophone = "granted" | "prompt" | "denied"

/** The first-call screen: what a call does, whether this server can start one, and how to set it up when it can't. */
export function VoiceOnboardingDialog(props: {
  access: VoiceAccess
  microphone: VoiceMicrophone
  onStart: () => void
  onConnect: (provider: "opencode" | "openai") => void
  onRetry: () => void
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const ready = () => props.access.type === "ready" && props.microphone !== "denied"

  return (
    <Dialog fit containerClass="!w-[min(calc(100vw_-_32px),460px)] !rounded-xl">
      <div class="voice-onboarding" data-access={props.access.type} data-scrollable>
        <div class="voice-onboarding-hero">
          <DemoScope />
          <CloseButton class="voice-onboarding-close" aria-label={language.t("voice.onboarding.later")}>
            <Icon name="close" />
          </CloseButton>
        </div>

        <div class="voice-onboarding-copy">
          <span class="voice-onboarding-eyebrow">{language.t("voice.onboarding.eyebrow")}</span>
          <DialogTitle>{language.t("voice.onboarding.title")}</DialogTitle>
          <p>{language.t("voice.onboarding.description")}</p>
        </div>

        {/* Without GPT-Live the screen is about setting it up, so the tour steps aside. */}
        <Show when={props.access.type !== "missing"}>
          <ul class="voice-onboarding-features">
            <For each={features}>
              {(feature) => (
                <li>
                  <span class="voice-onboarding-feature-icon">
                    <Icon name={feature.icon} />
                  </span>
                  <span>
                    <strong>{language.t(feature.title)}</strong>
                    <span>{language.t(feature.body)}</span>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <section class="voice-onboarding-checks" aria-label={language.t("voice.onboarding.checks")}>
          <span class="voice-onboarding-section">{language.t("voice.onboarding.checks")}</span>
          <div class="voice-onboarding-check">
            <span class="voice-onboarding-check-label">GPT-Live</span>
            <Switch>
              <Match when={props.access.type === "checking"}>
                <span class="voice-onboarding-status">
                  <Loader class="size-3.5" />
                  {language.t("voice.onboarding.access.checking")}
                </span>
              </Match>
              <Match when={props.access.type === "ready" && props.access.via}>
                {(via) => (
                  <span class="voice-onboarding-status" data-tone="ready">
                    <Icon name="check" />
                    {language.t(
                      via() === "console" ? "voice.onboarding.access.console" : "voice.onboarding.access.openai",
                    )}
                  </span>
                )}
              </Match>
              <Match when={props.access.type === "missing"}>
                <span class="voice-onboarding-status" data-tone="missing">
                  {language.t("voice.onboarding.access.missing")}
                </span>
              </Match>
              <Match when={props.access.type === "unreachable"}>
                <span class="voice-onboarding-status" data-tone="missing">
                  {language.t("voice.onboarding.access.unreachable")}
                </span>
              </Match>
            </Switch>
          </div>
          <div class="voice-onboarding-check">
            <span class="voice-onboarding-check-label">{language.t("voice.onboarding.microphone")}</span>
            <span class="voice-onboarding-status" data-tone={props.microphone === "denied" ? "missing" : undefined}>
              <Show when={props.microphone === "granted"}>
                <Icon name="check" />
              </Show>
              {language.t(`voice.onboarding.microphone.${props.microphone}`)}
            </span>
          </div>
          <Show when={props.access.type === "ready" && props.access.via}>
            {(via) => (
              <span class="voice-onboarding-billing">
                {language.t(
                  via() === "console" ? "voice.onboarding.billing.console" : "voice.onboarding.billing.openai",
                )}
              </span>
            )}
          </Show>
        </section>

        <Show when={props.access.type === "missing"}>
          <section class="voice-onboarding-setup">
            <strong>{language.t("voice.onboarding.setup.title")}</strong>
            <p>{language.t("voice.onboarding.setup.description")}</p>
            <div class="voice-onboarding-option">
              <ProviderIcon id="opencode" class="size-5 shrink-0" aria-hidden="true" />
              <span>
                <strong>{language.t("provider.connect.opencode.name")}</strong>
                <span>{language.t("voice.onboarding.setup.console")}</span>
              </span>
              <Button variant="neutral" onClick={() => props.onConnect("opencode")}>
                {language.t("voice.onboarding.setup.connect")}
              </Button>
            </div>
            <div class="voice-onboarding-option">
              <ProviderIcon id="openai" class="size-5 shrink-0" aria-hidden="true" />
              <span>
                <strong>{language.t("voice.onboarding.setup.openai.title")}</strong>
                <span>{language.t("voice.onboarding.setup.openai")}</span>
              </span>
              <Button variant="neutral" onClick={() => props.onConnect("openai")}>
                {language.t("voice.onboarding.setup.key")}
              </Button>
            </div>
            <p class="voice-onboarding-footnote">{language.t("voice.onboarding.setup.chatgpt")}</p>
          </section>
        </Show>

        <DialogFooter>
          <Button variant="neutral" onClick={() => dialog.close()}>
            {language.t("voice.onboarding.later")}
          </Button>
          <Show
            when={props.access.type !== "unreachable"}
            fallback={
              <Button variant="contrast" onClick={() => props.onRetry()}>
                {language.t("voice.onboarding.retry")}
              </Button>
            }
          >
            <Button variant="contrast" disabled={!ready()} onClick={() => props.onStart()}>
              {language.t("voice.onboarding.start")}
            </Button>
          </Show>
        </DialogFooter>
      </div>
    </Dialog>
  )
}

/** Opens the first-call screen for a server, checks it, and connects GPT-Live from it when the server can't call. */
export function DialogVoiceOnboarding(props: { ctx: ServerCtx; directory?: string; onStart: () => void }) {
  const dialog = useDialog()

  const [state, setState] = createStore<{ access: VoiceAccess; microphone: VoiceMicrophone }>({
    access: { type: "checking" },
    microphone: "prompt",
  })

  const check = async () => {
    setState("access", { type: "checking" })

    const [offered, microphone] = await Promise.all([
      props.ctx.sdk.api.experimental.voice.models().catch(() => undefined),
      microphonePermission(),
    ])

    setState("microphone", microphone)

    if (!offered) return setState("access", { type: "unreachable" })
    const live = offered.models.find((model) => model.model === "gpt-live-1" && model.transports.includes("webrtc"))

    if (!live?.available) return setState("access", { type: "missing" })
    setState("access", { type: "ready", via: live.provider === "opencode" ? "console" : "openai" })
  }

  onMount(() => void check())

  const connect = (provider: "opencode" | "openai") => {
    void import("@/providers/connect/dialog").then((x) => {
      const controller = x.useProviderConnectController()
      controller.select(provider)
      // Stacked over this screen, which checks again once it's closed.
      void dialog.push(
        () => <x.DialogConnectProvider controller={controller} directory={props.directory} standalone />,
        () => void check(),
      )
    })
  }

  return (
    <VoiceOnboardingDialog
      access={state.access}
      microphone={state.microphone}
      onStart={() => {
        dialog.close()
        props.onStart()
      }}
      onConnect={connect}
      onRetry={() => void check()}
    />
  )
}

const features = [
  { icon: "voice", title: "voice.onboarding.speak.title", body: "voice.onboarding.speak.body" },
  { icon: "transcript", title: "voice.onboarding.follow.title", body: "voice.onboarding.follow.body" },
  { icon: "microphone", title: "voice.onboarding.control.title", body: "voice.onboarding.control.body" },
] as const satisfies readonly { icon: IconName; title: string; body: string }[]

async function microphonePermission(): Promise<VoiceMicrophone> {
  // SAFETY: "microphone" is a permission name Chromium supports; TypeScript's PermissionName omits it.
  const status = await navigator.permissions?.query({ name: "microphone" as PermissionName }).catch(() => undefined)

  if (status?.state === "granted" || status?.state === "denied") return status.state

  return "prompt"
}

// The hero: the call's own scope on a made-up conversation, you and then the agent.
function DemoScope() {
  const meter = { mic: 0, speaker: 0 }
  const started = performance.now()

  const timer = setInterval(() => {
    const time = ((performance.now() - started) / 1000) % 7

    const speech = (from: number, to: number) => {
      if (time < from || time >= to) return 0
      const phrase = Math.sin((Math.PI * (time - from)) / (to - from)) ** 0.4

      return (0.02 + 0.09 * Math.abs(Math.sin(Math.PI * 4.3 * (time - from))) ** 0.7) * phrase
    }

    meter.mic = speech(0.6, 2.8)
    meter.speaker = speech(3.3, 6.4)
  }, 50)

  onCleanup(() => clearInterval(timer))

  return <VoiceScope meter={meter} status="connected" muted={false} />
}
