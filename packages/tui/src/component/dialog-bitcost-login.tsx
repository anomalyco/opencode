import { createSignal, onMount, Match, Switch } from "solid-js"
import { useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"
import { useClipboard } from "../context/clipboard"
import { useBindings } from "../keymap"
import { Link } from "../ui/link"
import { TextAttributes } from "@opentui/core"
import { Global } from "@opencode-ai/core/global"
import path from "node:path"
import fs from "node:fs"
import open from "open"

// Public Passport device client created via:
//   php artisan passport:client --device --public --name="Bitcost CLI"
// A distributed CLI is a public client and cannot keep a secret. Overridable via
// env so a DB reset (which mints a new client id) doesn't require a rebuild.
const BITCOST_CLIENT_ID = process.env.BITCOST_CLIENT_ID ?? "019ec10f-3871-7361-90e8-2b7cfb38dbf7"
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"
const POLL_INTERVAL_MS = 5000

// Global.Path.data is <xdg-data>/opencode; store bitcost credentials in a
// sibling <xdg-data>/bitcost directory instead.
const AUTH_FILE = path.join(path.dirname(Global.Path.data), "bitcost", "bitcost-auth.json")

function baseUrl() {
  return (process.env.BITCOST_URL ?? "https://bitcost.test").replace(/\/+$/, "")
}

/** True when bitcost credentials with an access token are stored on disk. */
export function bitcostLoggedIn(): boolean {
  try {
    return typeof (JSON.parse(fs.readFileSync(AUTH_FILE, "utf8")) as { access_token?: string }).access_token === "string"
  } catch {
    return false
  }
}

interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval?: number
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

// Bun's fetch accepts a `tls` option. Herd (and similar) serve local sites over
// https with a CA the runtime doesn't trust ("unable to verify the first
// certificate"), so skip verification for local dev hosts ONLY.
function localTls(url: string): Record<string, unknown> {
  try {
    const host = new URL(url).hostname
    if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".test")) {
      return { tls: { rejectUnauthorized: false } }
    }
  } catch {
    // ignore malformed URLs; fall through to default (verified) fetch
  }
  return {}
}

function devFetch(url: string, init: RequestInit = {}) {
  return fetch(url, { ...init, ...localTls(url) } as RequestInit)
}

// The `tls` fetch option only helps Bun; Node's fetch ignores it. For local dev
// hosts, also relax verification via the env var (honored by both runtimes) for
// the duration of the login flow, then restore it. Production hosts are untouched.
function relaxTlsForLocal(url: string): () => void {
  if (Object.keys(localTls(url)).length === 0) return () => {}
  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
  return () => {
    if (prev === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev
  }
}

async function form(url: string, body: Record<string, string>) {
  return devFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(body).toString(),
  })
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

type State =
  | { phase: "loading" }
  | { phase: "waiting"; userCode: string; verificationUri: string }
  | { phase: "error"; message: string }

export function DialogBitcostLogin() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const toast = useToast()
  const clipboard = useClipboard()

  const [state, setState] = createSignal<State>({ phase: "loading" })

  useBindings(() => ({
    bindings: [
      {
        key: "c",
        desc: "Copy code",
        group: "Dialog",
        cmd: () => {
          const s = state()
          if (s.phase !== "waiting") return
          clipboard
            .write?.(s.userCode)
            .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
            .catch(toast.error)
        },
      },
    ],
  }))

  onMount(async () => {
    const base = baseUrl()
    const restoreTls = relaxTlsForLocal(base)
    try {
      // 1. Request a device + user code.
      const deviceRes = await form(`${base}/oauth/device/code`, {
        client_id: BITCOST_CLIENT_ID,
        scope: "",
      })
      if (!deviceRes.ok) throw new Error(`Device code request failed (${deviceRes.status})`)
      const device = (await deviceRes.json()) as DeviceCodeResponse

      setState({ phase: "waiting", userCode: device.user_code, verificationUri: device.verification_uri })
      open(device.verification_uri).catch(() => {})

      // 2. Poll the token endpoint until the user approves or the code expires.
      const deadline = Date.now() + device.expires_in * 1000
      let intervalMs = (device.interval ?? POLL_INTERVAL_MS / 1000) * 1000
      while (Date.now() < deadline) {
        await sleep(intervalMs)
        const tokenRes = await form(`${base}/oauth/token`, {
          grant_type: DEVICE_GRANT,
          device_code: device.device_code,
          client_id: BITCOST_CLIENT_ID,
        })
        const token = (await tokenRes.json()) as TokenResponse

        if (token.access_token) {
          await finish(base, token)
          return
        }
        switch (token.error) {
          case "authorization_pending":
            continue
          case "slow_down":
            intervalMs += 5000
            continue
          case "expired_token":
            throw new Error("The login code expired. Run /login again.")
          case "access_denied":
            throw new Error("Login was denied.")
          default:
            throw new Error(token.error_description ?? token.error ?? "Login failed.")
        }
      }
      throw new Error("The login code expired. Run /login again.")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed."
      setState({ phase: "error", message })
      toast.show({ variant: "error", message })
      setTimeout(() => dialog.clear(), 2500)
    } finally {
      restoreTls()
    }
  })

  async function finish(base: string, token: TokenResponse) {
    // 3. Identify the user (and their Department) with the new token.
    //    A Department is a non-personal Team; a personal team (is_personal) does
    //    not count as a Department, so the user is treated as having none.
    let name = "unknown"
    let email: string | undefined
    let department: string | undefined
    try {
      const userRes = await devFetch(`${base}/api/user`, {
        headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json" },
      })
      if (userRes.ok) {
        const user = (await userRes.json()) as {
          name?: string
          email?: string
          current_team?: { name?: string; is_personal?: boolean }
          currentTeam?: { name?: string; is_personal?: boolean }
        }
        email = user.email
        name = user.name ?? user.email ?? name
        const currentTeam = user.current_team ?? user.currentTeam
        if (currentTeam && currentTeam.is_personal === false) department = currentTeam.name
      }
    } catch {
      // Identity lookup is best-effort; the token is still valid.
    }

    // 4. Persist the credentials for later use.
    const record = {
      url: base,
      name,
      email: email ?? null,
      department: department ?? null,
      access_token: token.access_token,
      refresh_token: token.refresh_token ?? null,
      expires_at: token.expires_in ? Date.now() + token.expires_in * 1000 : null,
    }
    fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true })
    fs.writeFileSync(AUTH_FILE, JSON.stringify(record, null, 2))

    toast.show({
      variant: "success",
      message: department ? `Logged in as ${name} (${department})` : `Logged in as ${name}`,
    })
    dialog.clear()
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Login to Bitcost
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <Switch>
        <Match when={state().phase === "loading"}>
          <text fg={theme.textMuted}>Requesting a login code…</text>
        </Match>
        <Match when={state().phase === "waiting" ? (state() as Extract<State, { phase: "waiting" }>) : undefined}>
          {(s) => (
            <box gap={1}>
              <box flexDirection="row" gap={1}>
                <text fg={theme.textMuted}>Enter code:</text>
                <text attributes={TextAttributes.BOLD} fg={theme.primary}>
                  {s().userCode}
                </text>
              </box>
              <Link href={s().verificationUri} fg={theme.primary} />
              <text fg={theme.textMuted}>Waiting for approval in your browser…</text>
              <text fg={theme.text}>
                c <span style={{ fg: theme.textMuted }}>copy</span>
              </text>
            </box>
          )}
        </Match>
        <Match when={state().phase === "error" ? (state() as Extract<State, { phase: "error" }>) : undefined}>
          {(s) => <text fg={theme.error}>{s().message}</text>}
        </Match>
      </Switch>
    </box>
  )
}
