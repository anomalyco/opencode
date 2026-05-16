import { createResource, For, Match, Show, Switch } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { usePlatform, type OpenbarProviderUsage, type OpenbarStatusResult } from "@/context/platform"

const errorResult = (r: OpenbarStatusResult | undefined): { ok: false; error: string } | null => (r && !r.ok ? r : null)

const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude",
  codex: "Codex (ChatGPT)",
  copilot: "GitHub Copilot",
  openrouter: "OpenRouter",
  opencode_zen: "OpenCode Zen",
  gemini_cli: "Gemini CLI",
  antigravity: "Antigravity",
  nano_gpt: "Nano-GPT",
  kimi: "Kimi",
  minimax_coding_plan: "MiniMax",
  zai_coding_plan: "Z.AI",
  brave_search: "Brave Search",
  tavily: "Tavily",
  synthetic: "Synthetic",
  chutes: "Chutes AI",
}

const label = (id: string) => PROVIDER_LABELS[id] ?? id

function formatCost(cost: unknown) {
  if (typeof cost !== "number") return null
  return `$${cost.toFixed(2)}`
}

function formatReset(iso: unknown) {
  if (typeof iso !== "string") return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString()
}

function ProviderRow(props: { id: string; usage: OpenbarProviderUsage }) {
  const pct = () => {
    const p = props.usage.usagePercentage
    return typeof p === "number" ? Math.max(0, Math.min(100, p)) : null
  }
  const isQuota = () => props.usage.type === "quota-based"

  return (
    <div class="flex flex-col gap-2 p-3 rounded-md border border-border-base">
      <div class="flex items-center justify-between gap-3">
        <div class="text-14-medium text-text-strong">{label(props.id)}</div>
        <Switch>
          <Match when={isQuota() && pct() !== null}>
            <div class="text-12-regular text-text-base font-mono">{pct()!.toFixed(0)}% used</div>
          </Match>
          <Match when={!isQuota() && formatCost(props.usage.cost)}>
            <div class="text-12-regular text-text-base font-mono">{formatCost(props.usage.cost)}</div>
          </Match>
        </Switch>
      </div>

      <Show when={isQuota() && pct() !== null}>
        <div class="h-1.5 w-full bg-surface-base rounded-full overflow-hidden">
          <div
            class="h-full bg-icon-interactive-base"
            style={{ width: `${pct()}%` }}
            classList={{
              "bg-status-error-base": (pct() ?? 0) >= 90,
              "bg-status-warning-base": (pct() ?? 0) >= 70 && (pct() ?? 0) < 90,
            }}
          />
        </div>
      </Show>

      <div class="flex flex-wrap gap-x-4 gap-y-1 text-12-regular text-text-base">
        <Show when={isQuota() && props.usage.remaining !== undefined}>
          <span>
            remaining: <span class="font-mono">{String(props.usage.remaining)}</span>
            <Show when={props.usage.entitlement !== undefined}>
              {" / "}
              <span class="font-mono">{String(props.usage.entitlement)}</span>
            </Show>
          </span>
        </Show>
        <Show when={formatReset(props.usage.resetsAt)}>
          <span>resets: {formatReset(props.usage.resetsAt)}</span>
        </Show>
        <Show when={props.usage.overagePermitted}>
          <span class="text-status-warning-base">overage allowed</span>
        </Show>
      </div>

      <Show when={Array.isArray(props.usage.accounts) && (props.usage.accounts?.length ?? 0) > 1}>
        <div class="flex flex-col gap-1 mt-1 pl-3 border-l border-border-base">
          <For each={props.usage.accounts}>
            {(acct) => {
              const pAcc = typeof acct.usagePercentage === "number" ? acct.usagePercentage : null
              const email = typeof acct.email === "string" ? acct.email : null
              const accountId = typeof acct.accountId === "string" ? acct.accountId : null
              const idx = typeof acct.index === "number" || typeof acct.index === "string" ? String(acct.index) : "?"
              return (
                <div class="flex items-center justify-between text-12-regular text-text-base">
                  <span class="truncate">{email ?? accountId ?? `account ${idx}`}</span>
                  <span class="font-mono">{pAcc !== null ? `${pAcc.toFixed(0)}%` : "—"}</span>
                </div>
              )
            }}
          </For>
        </div>
      </Show>
    </div>
  )
}

export function DialogOpenbarUsage() {
  const dialog = useDialog()
  const platform = usePlatform()

  const fetcher = async (): Promise<OpenbarStatusResult> => {
    if (!platform.openbarStatus) {
      return { ok: false, error: "OpenBar GUI integration is only available on the desktop app." }
    }
    return platform.openbarStatus()
  }

  const [result, { refetch }] = createResource(fetcher)

  const entries = () => {
    const r = result()
    if (!r || !r.ok) return [] as Array<[string, OpenbarProviderUsage]>
    return Object.entries(r.data)
  }

  return (
    <Dialog
      size="large"
      fit
      class="w-[min(calc(100vw-40px),640px)] max-h-[min(calc(100vh-40px),720px)] overflow-hidden"
    >
      <div class="flex flex-col gap-4 p-6 overflow-hidden">
        <div class="flex items-start justify-between gap-3">
          <div class="flex flex-col gap-1">
            <h2 class="text-16-medium text-text-strong">Provider Token Usage</h2>
            <p class="text-12-regular text-text-base">
              Pulled from{" "}
              <a
                href="https://github.com/opgginc/opencode-bar"
                onClick={(e) => {
                  e.preventDefault()
                  platform.openLink("https://github.com/opgginc/opencode-bar")
                }}
                class="underline"
              >
                OpenBar GUI
              </a>{" "}
              via <code class="font-mono">opencodebar status --json</code>.
            </p>
          </div>
          <div class="flex items-center gap-2">
            <Button variant="secondary" size="small" onClick={() => refetch()} disabled={result.loading}>
              {result.loading ? "Loading…" : "Refresh"}
            </Button>
            <Button variant="ghost" size="small" onClick={() => dialog.close()}>
              Close
            </Button>
          </div>
        </div>

        <div class="flex flex-col gap-2 overflow-auto pr-1">
          <Switch>
            <Match when={result.loading && !result()}>
              <div class="text-12-regular text-text-base p-4 text-center">Fetching provider usage…</div>
            </Match>
            <Match when={errorResult(result())}>
              {(r) => (
                <div class="flex flex-col gap-2 p-4 rounded-md border border-status-error-base">
                  <div class="text-14-medium text-text-strong">Could not load usage</div>
                  <div class="text-12-regular text-text-base">{r().error}</div>
                  <div class="text-12-regular text-text-base">
                    Install the CLI:{" "}
                    <a
                      href="https://github.com/opgginc/opencode-bar"
                      onClick={(e) => {
                        e.preventDefault()
                        platform.openLink("https://github.com/opgginc/opencode-bar")
                      }}
                      class="underline"
                    >
                      opgginc/opencode-bar
                    </a>
                  </div>
                </div>
              )}
            </Match>
            <Match when={result()?.ok && entries().length === 0}>
              <div class="text-12-regular text-text-base p-4 text-center">No providers configured.</div>
            </Match>
            <Match when={result()?.ok && entries().length > 0}>
              <For each={entries()}>{([id, usage]) => <ProviderRow id={id} usage={usage} />}</For>
            </Match>
          </Switch>
        </div>
      </div>
    </Dialog>
  )
}
