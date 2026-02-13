/**
 * Remote Access Settings Section
 *
 * Settings UI for managing tunnel connectivity for remote access.
 * Shows Tailscale detection and Cloudflare tunnel toggle.
 */

import { createResource, createSignal, Show, type JSX } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Switch } from "@opencode-ai/ui/switch"
import { useConfigOptional } from "../context/config"
import { useServer, usePlatform } from "@opencode-ai/claxedo-app"

interface TunnelStatus {
  enabled: boolean
  url: string | null
  provider: "cloudflare" | null
  tailscale: { ip: string; hostname: string } | null
}

/**
 * Generate QR code as SVG using a simple implementation
 * Uses the QR Code API service for simplicity
 */
function QRCode(props: { url: string; size?: number }): JSX.Element {
  const size = () => props.size ?? 128
  const qrApiUrl = () =>
    `https://api.qrserver.com/v1/create-qr-code/?size=${size()}x${size()}&data=${encodeURIComponent(props.url)}`

  return (
    <div class="flex items-center justify-center p-3 bg-white rounded-lg">
      <img
        src={qrApiUrl()}
        alt="QR Code"
        width={size()}
        height={size()}
        class="rounded"
      />
    </div>
  )
}

/**
 * Copy button with "Copied!" feedback
 */
function CopyButton(props: { text: string; label?: string }): JSX.Element {
  const [copied, setCopied] = createSignal(false)

  const handleCopy = () => {
    const write = navigator.clipboard?.writeText
    if (!write) return
    void write.call(navigator.clipboard, props.text)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => {
        console.error("Failed to copy to clipboard")
      })
  }

  return (
    <Button
      size="small"
      variant="secondary"
      onClick={handleCopy}
    >
      {copied() ? "Copied!" : (props.label ?? "Copy")}
    </Button>
  )
}

async function fetchTunnelStatus(url: string, fetchFn: typeof fetch): Promise<TunnelStatus> {
  try {
    const res = await fetchFn(`${url}/tunnel/status`)
    if (!res.ok) throw new Error("Failed to fetch tunnel status")
    const text = await res.text()
    try {
      return JSON.parse(text) as TunnelStatus
    } catch {
      console.error("[RemoteAccessSettings] Invalid JSON from /tunnel/status", {
        url,
        preview: text.slice(0, 80),
      })
      return {
        enabled: false,
        url: null,
        provider: null,
        tailscale: null,
      }
    }
  } catch {
    return {
      enabled: false,
      url: null,
      provider: null,
      tailscale: null,
    }
  }
}

/**
 * Remote Access Settings component.
 * Can be added to settingsSections when tunnelEnabled is true.
 */
export function RemoteAccessSettings(): JSX.Element | null {
  const config = useConfigOptional()
  const server = useServer()
  const platform = usePlatform()
  const [loading, setLoading] = createSignal(false)

  const valid = (input: string | null | undefined) => {
    if (!input) return
    const ok =
      typeof URL === "function" && "canParse" in URL
        ? URL.canParse(input)
        : /^https?:\/\//.test(input)
    if (!ok) return
    if (!/^https?:\/\//.test(input)) return
    return input
  }

  // Fetch tunnel status from server
  const [status, { refetch }] = createResource(
    () => valid(server.url) ?? null,
    (url) => {
      if (!url) {
        return {
          enabled: false,
          url: null,
          provider: null,
          tailscale: null,
        } satisfies TunnelStatus
      }
      const fetchFn = platform.fetch ?? fetch
      return fetchTunnelStatus(url, fetchFn)
    }
  )

  const toggleTunnel = async () => {
    const url = valid(server.url)
    if (loading() || !url) return

    setLoading(true)
    try {
      const endpoint = status()?.enabled ? "/tunnel/stop" : "/tunnel/start"
      const fetchFn = platform.fetch ?? fetch
      const res = await fetchFn(`${url}${endpoint}`, { method: "POST" })
      if (!res.ok) throw new Error("Failed to toggle tunnel")
      await refetch()
    } catch (err) {
      console.error("[RemoteAccessSettings] Toggle error:", err)
    } finally {
      setLoading(false)
    }
  }

  // Only show if tunnel is enabled in config
  if (!config?.tunnelEnabled) {
    return null
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-raised-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8">
          <h2 class="text-16-medium text-text-strong">Remote Access</h2>
          <p class="text-12-regular text-text-weak">
            Enable remote access to interact with local workspaces from other devices.
          </p>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        {/* Connection Section */}
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">Connection</h3>
          <div class="bg-surface-raised-base px-4 rounded-lg">
            {/* Tailscale Detection */}
            <Show when={status()?.tailscale}>
              {(tailscale) => {
                const tailscaleUrl = () => `http://${tailscale().hostname || tailscale().ip}:4096`
                return (
                  <>
                    <div class="flex flex-wrap items-center justify-between gap-4 py-3 border-b border-border-weak-base">
                      <div class="flex items-center gap-3 min-w-0">
                        <div class="shrink-0 p-1.5 rounded-md bg-blue-500/10">
                          <Icon name="server" size="normal" class="text-blue-500" />
                        </div>
                        <div class="flex flex-col gap-0.5 min-w-0">
                          <span class="text-14-medium text-text-strong">Tailscale Detected</span>
                          <code class="text-12-regular text-text-weak font-mono truncate">
                            {tailscaleUrl()}
                          </code>
                        </div>
                      </div>
                      <div class="flex-shrink-0">
                        <CopyButton text={tailscaleUrl()} />
                      </div>
                    </div>
                    <div class="flex flex-col items-center gap-2 py-4 border-b border-border-weak-base">
                      <QRCode url={tailscaleUrl()} size={160} />
                      <span class="text-12-regular text-text-weak">
                        Scan to open on any device on your Tailnet
                      </span>
                    </div>
                  </>
                )
              }}
            </Show>

            {/* Cloudflare Tunnel Toggle */}
            <div class="flex flex-wrap items-center justify-between gap-4 py-3 border-b border-border-weak-base last:border-none">
              <div class="flex flex-col gap-0.5 min-w-0">
                <span class="text-14-medium text-text-strong">Cloudflare Tunnel</span>
                <span class="text-12-regular text-text-weak">Creates a public URL for your local server</span>
              </div>
              <div class="flex-shrink-0">
                <Switch
                  checked={status()?.enabled ?? false}
                  disabled={loading() || status.loading}
                  onChange={toggleTunnel}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Public URL Section */}
        <Show when={status()?.enabled && status()?.url}>
          {(url) => (
            <div class="flex flex-col gap-1">
              <h3 class="text-14-medium text-text-strong pb-2">Public URL</h3>
              <div class="bg-surface-raised-base px-4 rounded-lg">
                {/* URL Display */}
                <div class="flex flex-wrap items-center justify-between gap-4 py-3 border-b border-border-weak-base">
                  <div class="flex flex-col gap-0.5 min-w-0">
                    <span class="text-14-medium text-text-strong">Tunnel URL</span>
                    <code class="text-12-regular text-text-weak font-mono truncate block">{url()}</code>
                  </div>
                  <div class="flex-shrink-0">
                    <CopyButton text={url()} />
                  </div>
                </div>

                {/* QR Code */}
                <div class="flex flex-col items-center gap-2 py-4">
                  <QRCode url={url()} size={160} />
                  <span class="text-12-regular text-text-weak">
                    Scan to open on your phone
                  </span>
                </div>
              </div>
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}
