/**
 * Local Server Setup Dialog
 *
 * Multi-step wizard for connecting a remote Claxedo gateway to a local
 * OpenCode server via Tailscale. Auto-shown when the frontend detects
 * it's on a remote host and the backend health check fails.
 */

import { createSignal, Show, For, onMount, onCleanup } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { checkServerHealth } from "@/utils/server-health"

const TOTAL_STEPS = 3

/**
 * Copy button with "Copied!" feedback
 */
function CopyButton(props: { text: string }) {
  const [copied, setCopied] = createSignal(false)

  const handleCopy = () => {
    const write = navigator.clipboard?.writeText
    if (!write) return
    void write.call(navigator.clipboard, props.text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  return (
    <button
      type="button"
      class="shrink-0 text-12-medium text-text-accent hover:text-text-accent/80 transition-colors"
      onClick={handleCopy}
    >
      {copied() ? "Copied!" : "Copy"}
    </button>
  )
}

/**
 * Code block with copy button
 */
function CodeBlock(props: { code: string; label?: string }) {
  return (
    <div class="flex flex-col gap-1">
      <Show when={props.label}>
        <span class="text-12-medium text-text-weak">{props.label}</span>
      </Show>
      <div class="flex items-center justify-between gap-2 bg-surface-raised-base rounded-md px-3 py-2 font-mono text-13-regular text-text-base">
        <code class="overflow-x-auto whitespace-pre">{props.code}</code>
        <CopyButton text={props.code} />
      </div>
    </div>
  )
}

/**
 * Step indicator dots
 */
function StepIndicator(props: { current: number; total: number }) {
  return (
    <div class="flex items-center gap-1.5">
      <For each={Array.from({ length: props.total })}>
        {(_, i) => (
          <div
            class="h-1.5 rounded-full transition-all"
            classList={{
              "w-4 bg-text-accent": i() === props.current,
              "w-1.5 bg-border-base": i() !== props.current,
            }}
          />
        )}
      </For>
      <span class="ml-1.5 text-12-regular text-text-weak">
        {props.current + 1}/{props.total}
      </span>
    </div>
  )
}

// ── Step Components ─────────────────────────────────────────────

const DESKTOP_RELEASE_URL = "https://github.com/kyashrathore/opencode/releases"

function StepFeatures() {
  return (
    <div class="flex flex-col gap-4">
      <p class="text-14-regular text-text-base">
        A powerful interface for managing AI coding agents — built on top of Claxedo.
      </p>

      {/* Feature cards */}
      <div class="grid grid-cols-2 gap-2.5">
        <For each={FEATURES}>
          {(feature) => (
            <div class="flex items-start gap-2.5 p-3 bg-surface-raised-base rounded-lg">
              <div class="shrink-0 mt-0.5">
                <Icon name="circle-check" size="small" class="text-text-accent" />
              </div>
              <div class="flex flex-col gap-0.5">
                <span class="text-13-medium text-text-strong">{feature.title}</span>
                <span class="text-12-regular text-text-weak">{feature.desc}</span>
              </div>
            </div>
          )}
        </For>
      </div>

      {/* Desktop app download */}
      <a
        href={DESKTOP_RELEASE_URL}
        target="_blank"
        rel="noopener noreferrer"
        class="bg-surface-raised-base rounded-lg p-4 flex items-start gap-3 border border-border-base hover:border-text-accent transition-colors no-underline"
      >
        <div class="shrink-0 mt-0.5 p-1.5 rounded-md bg-green-500/10">
          <Icon name="arrow-down-to-line" size="normal" class="text-green-400" />
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-13-medium text-text-strong">Download the Desktop App</span>
          <p class="text-13-regular text-text-weak">
            The easiest way to get started — bundles everything, no server setup required.
          </p>
          <span class="text-12-medium text-text-accent mt-1">
            Download from GitHub Releases &rarr;
          </span>
        </div>
      </a>
    </div>
  )
}

function StepTailscaleSetup(props: {
  url: string
  setUrl: (v: string) => void
  verifyState: "idle" | "loading" | "success" | "error"
  verifyError: string
  onVerify: () => void
}) {
  return (
    <div class="flex flex-col gap-4">
      <p class="text-14-regular text-text-base">
        Install Tailscale on your local machine to create a private encrypted connection.
      </p>

      {/* Install commands */}
      <div class="flex flex-col gap-3">
        <CodeBlock label="macOS" code="brew install tailscale && tailscale up" />
        <CodeBlock label="Linux" code="curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up" />
      </div>

      <div class="bg-surface-raised-base rounded-lg p-3">
        <p class="text-13-regular text-text-weak">
          Free for up to 100 devices. Once signed in, your machine gets a stable IP like <code class="text-text-base">100.x.x.x</code>.
        </p>
      </div>

      {/* Start server + verify */}
      <CodeBlock label="Start your Claxedo server" code="opencode server --port 4096" />

      <div class="flex flex-col gap-1.5">
        <label class="text-13-medium text-text-strong">Verify connection</label>
        <div class="flex gap-2">
          <input
            type="text"
            value={props.url}
            onInput={(e) => props.setUrl(e.currentTarget.value)}
            placeholder="http://100.64.x.x:4096"
            class="flex-1 bg-surface-raised-base text-14-regular text-text-base px-3 py-2 rounded-md border border-border-base focus:border-text-accent focus:outline-none"
          />
          <Button
            variant="primary"
            onClick={props.onVerify}
            disabled={props.verifyState === "loading" || !props.url.trim()}
          >
            {props.verifyState === "loading" ? "Checking..." : "Verify"}
          </Button>
        </div>
        <p class="text-12-regular text-text-weak">
          Use your Tailscale IP (<code class="text-text-base">tailscale ip -4</code>) + port 4096.
        </p>
      </div>

      {/* Verification result */}
      <Show when={props.verifyState === "success"}>
        <div class="flex items-center gap-2 bg-green-500/10 text-green-400 rounded-md px-3 py-2">
          <Icon name="circle-check" size="small" />
          <span class="text-13-medium">Connected successfully!</span>
        </div>
      </Show>
      <Show when={props.verifyState === "error"}>
        <div class="flex items-start gap-2 bg-red-500/10 text-red-400 rounded-md px-3 py-2">
          <Icon name="circle-x" size="small" class="mt-0.5 shrink-0" />
          <div class="flex flex-col gap-0.5">
            <span class="text-13-medium">Connection failed</span>
            <span class="text-12-regular">{props.verifyError || "Could not reach the server. Check the URL and ensure Tailscale is running."}</span>
          </div>
        </div>
      </Show>
    </div>
  )
}

function StepMultiDevice(props: { url: string }) {
  return (
    <div class="flex flex-col gap-4">
      <p class="text-14-regular text-text-base">
        Once connected, open this site from any device — it proxies to your local server via Tailscale.
      </p>

      {/* QR code in settings */}
      <div class="bg-surface-raised-base rounded-lg p-4 flex flex-col gap-2">
        <span class="text-13-medium text-text-strong">Scan & Go</span>
        <p class="text-13-regular text-text-weak">
          Open <strong>Settings &gt; Remote Access</strong> to find a QR code for this site. Scan it on your phone or tablet to open Claxedo instantly — it connects to your local server through this gateway.
        </p>
      </div>

      {/* Cloudflare Tunnel */}
      <div class="bg-surface-raised-base rounded-lg p-4 flex flex-col gap-2">
        <span class="text-13-medium text-text-strong">Cloudflare Tunnel</span>
        <p class="text-13-regular text-text-weak">
          Need a different URL? Enable <strong>Cloudflare Tunnel</strong> in Settings &gt; Remote Access to get a public URL — no account required. Useful if you want to share access outside your usual setup.
        </p>
      </div>

      {/* Make it permanent */}
      <Show when={props.url.trim()}>
        <div class="bg-surface-raised-base rounded-lg p-4 flex flex-col gap-2">
          <span class="text-13-medium text-text-strong">Make it permanent</span>
          <p class="text-13-regular text-text-weak">
            Set the <code class="text-text-base">OPENCODE_URL</code> environment variable so the gateway always connects to your local machine:
          </p>
          <CodeBlock code={`fly secrets set OPENCODE_URL=${props.url.trim()}`} />
        </div>
      </Show>
    </div>
  )
}

// ── Step titles ─────────────────────────────────────────────────

const STEP_TITLES = [
  "Welcome to Claxedo",
  "Tailscale Setup",
  "Access from Other Devices",
]

// ── Mobile Features View ────────────────────────────────────────

const FEATURES = [
  { title: "Parallel Agent Sessions", desc: "Create and run multiple coding agents simultaneously" },
  { title: "Any CLI Coding Agent", desc: "Claude Code, Codex, Amp, and more" },
  { title: "Easy Status Tracking", desc: "Monitor all your agent sessions at a glance" },
  { title: "Fully Local", desc: "Everything runs on your machine, your data stays private" },
  { title: "Multi Device", desc: "Access your sessions from any device on your network" },
  { title: "Open Source", desc: "Built on OpenCode, extended with a better, more powerful UI" },
]

function MobileFeaturesView() {
  return (
    <div class="flex flex-col items-center gap-8 p-6 w-full max-w-sm mx-auto">
      <div class="flex flex-col items-center gap-3 text-center">
        <span class="text-20-medium text-text-strong">Claxedo</span>
        <span class="text-14-regular text-text-weak">
          A powerful interface for managing AI coding agents
        </span>
      </div>

      <div class="flex flex-col gap-2.5 w-full">
        <For each={FEATURES}>
          {(feature) => (
            <div class="flex items-start gap-3 p-3 rounded-lg" style={{ background: "var(--surface-raised-base)" }}>
              <div class="shrink-0 mt-0.5">
                <Icon name="circle-check" size="small" class="text-text-accent" />
              </div>
              <div class="flex flex-col gap-0.5">
                <span class="text-13-medium text-text-strong">{feature.title}</span>
                <span class="text-12-regular text-text-weak">{feature.desc}</span>
              </div>
            </div>
          )}
        </For>
      </div>

      <div class="flex flex-col items-center gap-2 text-center">
        <span class="text-13-medium text-text-accent">Best viewed on desktop</span>
        <span class="text-12-regular text-text-weak">
          Open this page on a desktop browser for the full experience.
        </span>
      </div>
    </div>
  )
}

// ── Main Overlay ────────────────────────────────────────────────

export function DialogLocalSetup(props: { onDismiss: () => void }) {
  const [step, setStep] = createSignal(0)
  const [url, setUrl] = createSignal("")
  const [verifyState, setVerifyState] = createSignal<"idle" | "loading" | "success" | "error">("idle")
  const [verifyError, setVerifyError] = createSignal("")

  // Close on Escape
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") handleDismiss()
  }
  onMount(() => document.addEventListener("keydown", handleKeyDown))
  onCleanup(() => document.removeEventListener("keydown", handleKeyDown))

  const handleVerify = async () => {
    const target = url().trim()
    if (!target) return

    setVerifyState("loading")
    setVerifyError("")

    try {
      const result = await checkServerHealth(target, fetch, { timeoutMs: 5000 })
      if (result.healthy) {
        setVerifyState("success")
      } else {
        setVerifyState("error")
        setVerifyError("Server responded but health check reported unhealthy.")
      }
    } catch {
      setVerifyState("error")
      setVerifyError("Could not reach the server. Check the URL and ensure Tailscale is running on both devices.")
    }
  }

  const handleDismiss = () => {
    try {
      localStorage.setItem("claxedo.localSetupDismissed", "true")
    } catch {}
    props.onDismiss()
  }

  const handleNext = () => {
    if (step() < TOTAL_STEPS - 1) setStep(step() + 1)
  }

  const handleBack = () => {
    if (step() > 0) setStep(step() - 1)
  }

  return (
    <div
      class="fixed inset-0 z-50 overflow-y-auto"
      style={{ "backdrop-filter": "blur(16px)", "-webkit-backdrop-filter": "blur(16px)", background: "hsla(0, 0%, 0%, 0.45)" }}
    >
      <div
        class="min-h-full flex items-center justify-center p-4"
        onClick={handleDismiss}
      >
        {/* Mobile: features overview */}
        <div class="md:hidden" onClick={(e: MouseEvent) => e.stopPropagation()}>
          <MobileFeaturesView />
        </div>

        {/* Desktop: setup wizard */}
        <div
          class="hidden md:flex flex-col w-full max-w-[560px] rounded-xl overflow-hidden"
          style={{
            background: "var(--surface-raised-stronger-non-alpha)",
            "box-shadow": "var(--shadow-lg-border-base)",
          }}
          onClick={(e: MouseEvent) => e.stopPropagation()}
        >
          {/* Header */}
          <div class="flex items-center justify-between px-5 py-4 shrink-0 border-b border-border-weak-base">
            <span class="text-16-medium text-text-strong">{STEP_TITLES[step()]}</span>
            <button
              type="button"
              class="text-text-weak hover:text-text-base transition-colors p-1 rounded"
              onClick={handleDismiss}
            >
              <Icon name="close" size="normal" />
            </button>
          </div>

          {/* Step content — scrollable, height adapts to content */}
          <div class="p-5 overflow-y-auto" style={{ "max-height": "calc(90vh - 130px)" }}>
            <Show when={step() === 0}>
              <StepFeatures />
            </Show>
            <Show when={step() === 1}>
              <StepTailscaleSetup
                url={url()}
                setUrl={setUrl}
                verifyState={verifyState()}
                verifyError={verifyError()}
                onVerify={handleVerify}
              />
            </Show>
            <Show when={step() === 2}>
              <StepMultiDevice url={url()} />
            </Show>
          </div>

          {/* Footer */}
          <div class="flex items-center justify-between px-5 py-3 shrink-0 border-t border-border-weak-base">
            <StepIndicator current={step()} total={TOTAL_STEPS} />
            <div class="flex items-center gap-2">
              <Button variant="ghost" onClick={handleDismiss}>
                Dismiss
              </Button>
              <Show when={step() > 0}>
                <Button variant="secondary" onClick={handleBack}>
                  Back
                </Button>
              </Show>
              <Show when={step() < TOTAL_STEPS - 1}>
                <Button variant="primary" onClick={handleNext}>
                  Next
                </Button>
              </Show>
              <Show when={step() === TOTAL_STEPS - 1}>
                <Button variant="primary" onClick={handleDismiss}>
                  Done
                </Button>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Auto-detection logic ────────────────────────────────────────

const DISMISSED_KEY = "claxedo.localSetupDismissed"

/**
 * Check if the current host is remote (not localhost).
 */
function isRemoteHost(): boolean {
  const hostname = window.location.hostname
  return hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "0.0.0.0"
}

/**
 * Check if the user has dismissed the setup dialog.
 */
function isDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "true"
  } catch {
    return false
  }
}

/**
 * Detect if the local setup dialog should be shown.
 * Conditions: remote host, sandbox disabled, health check fails, not dismissed.
 *
 * /global/health is proxied to the upstream OpenCode server.
 * When the upstream is unreachable (502), we know the setup dialog should show.
 *
 * For local testing, add `?setup` to the URL to force-show the dialog.
 */
export async function shouldShowLocalSetup(sandboxEnabled: boolean | undefined): Promise<boolean> {
  // ?setup flag for local testing — bypasses all checks
  if (new URLSearchParams(window.location.search).has("setup")) return true

  if (!isRemoteHost()) return false
  if (sandboxEnabled) return false
  if (isDismissed()) return false

  const result = await checkServerHealth(window.location.origin, fetch, { timeoutMs: 3000 })
  return !result.healthy
}
