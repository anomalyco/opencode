import { Show, createSignal, For, onMount } from "solid-js"
import { Option, Schema } from "effect"
import { Button } from "@opencode/ui/button"
import { TextInput } from "@opencode/ui/text-input"
import { Icon } from "@opencode/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { ServerConnection } from "@/runtime/server/registry"
import { normalizeServerUrl } from "@/runtime/server/registry"

export type RelayEnvironment = {
  id: string
  name: string
  description?: string
  url?: string
  username?: string
  status?: string
  hostname?: string
  version?: string
  platform?: string
  tunnelHostname?: string
  deviceId?: string
  lastSeenAt?: number | null
  createdAt?: number
}

const STORAGE_KEY = "opencode.relay.account.v1"

type SavedAccount = {
  relayUrl: string
  username: string
  token: string
  password: string
}

const SavedAccountSchema = Schema.Struct({
  relayUrl: Schema.String,
  username: Schema.String,
  token: Schema.String,
  password: Schema.String,
})

const decodeSavedAccount = Schema.decodeUnknownOption(SavedAccountSchema)

// The relay's login response carries the session token.
const LoginResponse = Schema.Struct({ token: Schema.String })

const decodeLoginResponse = Schema.decodeUnknownOption(LoginResponse)

// The relay reports a failed login with an `error` message.
const LoginError = Schema.Struct({ error: Schema.optional(Schema.String) })

const decodeLoginError = Schema.decodeUnknownOption(LoginError)

// The relay's environment list. Fields the relay may omit are optional here so
// an older relay still renders.
const EnvironmentList = Schema.Struct({
  environments: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      description: Schema.optional(Schema.String),
      url: Schema.optional(Schema.String),
      username: Schema.optional(Schema.String),
      status: Schema.optional(Schema.String),
      hostname: Schema.optional(Schema.String),
      version: Schema.optional(Schema.String),
      platform: Schema.optional(Schema.String),
      tunnelHostname: Schema.optional(Schema.String),
      deviceId: Schema.optional(Schema.String),
      lastSeenAt: Schema.optional(Schema.NullOr(Schema.Number)),
      createdAt: Schema.optional(Schema.Number),
    }),
  ),
})

const decodeEnvironmentList = Schema.decodeUnknownOption(EnvironmentList)

function loadAccount(): SavedAccount | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)

    if (!raw) return null

    return Option.getOrUndefined(decodeSavedAccount(JSON.parse(raw))) ?? null
  } catch {
    return null
  }
}

function saveAccount(account: SavedAccount) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(account))
  } catch {
    // ignore quota / private mode errors
  }
}

function clearAccount() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

export function RelayDiscovery(props: {
  /** Reports a discovered server; the form checks it and saves it. */
  onConnected: (http: ServerConnection.HttpBase) => void
  onBack: () => void
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const fetcher = platform.fetch ?? globalThis.fetch

  const [relayUrl, setRelayUrl] = createSignal("")
  const [username, setUsername] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [error, setError] = createSignal("")
  const [loading, setLoading] = createSignal(false)
  const [environments, setEnvironments] = createSignal<RelayEnvironment[]>([])
  const [token, setToken] = createSignal("")
  const [connecting, setConnecting] = createSignal(false)
  const [signedIn, setSignedIn] = createSignal(false)

  onMount(() => {
    void (async () => {
      // First, try the share-service account (Settings → General → Device Sharing).
      // If the user already saved relay credentials there, reuse them so they
      // don't have to log in a second time in this page.
      if ("getShareAccount" in platform) {
        try {
          const shareAccount = await platform.getShareAccount?.()

          if (shareAccount) {
            setRelayUrl(shareAccount.relayUrl)
            setUsername(shareAccount.username)
            setPassword(shareAccount.password)
            // Log in to get a fresh token for environment discovery.
            await login(true)

            return
          }
        } catch {
          // fall through to localStorage
        }
      }

      // Fall back to a previously saved relay-discovery session in localStorage.
      const saved = loadAccount()

      if (saved) {
        setRelayUrl(saved.relayUrl)
        setUsername(saved.username)
        setToken(saved.token)
        setPassword(saved.password)
        setSignedIn(true)
        void loadEnvironments(saved.relayUrl, saved.token)
      }
    })()
  })

  // Silently re-login with saved credentials after a 401 (e.g. relay restarted
  // and lost the session). Returns a fresh token, or undefined on failure.
  async function relogin(base: string): Promise<string | undefined> {
    try {
      const res = await fetcher(new URL("/api/auth/login", base), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: username().trim(), password: password() }),
      })

      if (!res.ok) return undefined

      const data = await res.json()
      const freshToken = Option.getOrUndefined(decodeLoginResponse(data))?.token

      if (!freshToken) return undefined
      setToken(freshToken)
      saveAccount({ relayUrl: base, username: username().trim(), token: freshToken, password: password() })

      return freshToken
    } catch {
      return undefined
    }
  }

  async function loadEnvironments(url: string, bearerToken: string) {
    setError("")
    setLoading(true)
    const base = normalizeServerUrl(url)

    if (!base) {
      setError(language.t("server.connect.relay.invalidUrl"))
      setLoading(false)

      return
    }

    try {
      let res = await fetcher(new URL("/api/environments", base), {
        headers: { authorization: `Bearer ${bearerToken}` },
      })

      // Token expired (e.g. relay restarted). Silently re-login with saved
      // credentials and retry once. Only kick the user back to the login
      // form if re-login also fails — which means the password changed.
      if (res.status === 401 && username() && password()) {
        const freshToken = await relogin(base)

        if (freshToken) {
          res = await fetcher(new URL("/api/environments", base), {
            headers: { authorization: `Bearer ${freshToken}` },
          })
        }
      }

      if (!res.ok) {
        if (res.status === 401) {
          clearAccount()
          setSignedIn(false)
          setToken("")
          setError(language.t("server.connect.relay.loginFailed"))
        } else {
          setError(`${res.status} ${res.statusText}`)
        }

        return
      }

      const data = await res.json()
      const list = Option.getOrUndefined(decodeEnvironmentList(data))

      if (!list) {
        setError(`${res.status} ${res.statusText}`)

        return
      }

      setEnvironments([...list.environments])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function login(fromShareAccount = false) {
    setError("")
    setLoading(true)

    try {
      const base = normalizeServerUrl(relayUrl())

      if (!base) {
        setError(language.t("server.connect.relay.invalidUrl"))

        return
      }

      const res = await fetcher(new URL("/api/auth/login", base), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: username().trim(), password: password() }),
      })

      if (!res.ok) {
        const detail = await res.json().catch(() => undefined)
        const message = Option.getOrUndefined(decodeLoginError(detail))?.error

        setError(message || language.t("server.connect.relay.loginFailed"))

        return
      }

      const data = await res.json()
      const session = Option.getOrUndefined(decodeLoginResponse(data))

      if (!session) {
        setError(language.t("server.connect.relay.loginFailed"))

        return
      }

      setToken(session.token)
      setSignedIn(true)
      const account = { relayUrl: base, username: username().trim(), token: session.token, password: password() }
      saveAccount(account)

      // When the user logs in here for the first time, also propagate the
      // credentials to the share-service so the Settings page doesn't ask
      // for them again. Skip this when we were called from the share-service
      // account itself to avoid a redundant write.
      if (!fromShareAccount && "saveShareAccount" in platform) {
        try {
          await platform.saveShareAccount?.({ relayUrl: base, username: username().trim(), password: password() })
        } catch {
          // The share-service save is best-effort; don't block discovery on it.
        }
      }

      await loadEnvironments(base, session.token)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  function signOut() {
    clearAccount()
    setSignedIn(false)
    setToken("")
    setEnvironments([])
    setPassword("")
    setError("")
  }

  async function connectEnv(env: RelayEnvironment) {
    setConnecting(true)
    setError("")

    try {
      const base = normalizeServerUrl(relayUrl())

      if (!base) return
      const proxyUrl = `${base}/api/proxy/${env.id}`
      // The relay proxy authenticates with Basic Auth: username is "opencode",
      // password is the relay account password we saved on login.
      const http = { url: proxyUrl, password: password() }
      props.onConnected(http)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setConnecting(false)
    }
  }

  // How long ago the device was last seen, in a compact form.
  function lastSeen(timestamp: number) {
    const elapsed = Date.now() - timestamp

    if (elapsed < 60_000) return language.t("server.connect.relay.lastSeen.justNow")
    const minutes = Math.floor(elapsed / 60_000)

    if (minutes < 60) return language.t("server.connect.relay.lastSeen.minutes", { count: minutes })
    const hours = Math.floor(minutes / 60)

    if (hours < 24) return language.t("server.connect.relay.lastSeen.hours", { count: hours })

    return language.t("server.connect.relay.lastSeen.days", { count: Math.floor(hours / 24) })
  }

  const ONLINE = "online"

  return (
    <div class="flex flex-col gap-4">
      <Show when={!signedIn()}>
        <div class="flex flex-col gap-3">
          <p class="text-[13px] leading-5 tracking-[-0.04px] text-v2-text-text-muted">
            {language.t("server.connect.relay.description")}
          </p>
          <div class="flex flex-col gap-1">
            <label class="text-[13px] font-[530] leading-4 text-v2-text-text-base">
              {language.t("server.connect.relay.url")}
            </label>
            <TextInput
              type="text"
              inputMode="url"
              autocapitalize="off"
              spellcheck={false}
              required
              appearance="large"
              placeholder="https://relay.example.com:9999"
              value={relayUrl()}
              disabled={loading() || connecting()}
              onInput={(e) => setRelayUrl(e.currentTarget.value)}
            />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-[13px] font-[530] leading-4 text-v2-text-text-base">
              {language.t("server.connect.relay.username")}
            </label>
            <TextInput
              type="text"
              autocapitalize="off"
              autocomplete="username"
              required
              appearance="large"
              placeholder="alex"
              value={username()}
              disabled={loading() || connecting()}
              onInput={(e) => setUsername(e.currentTarget.value)}
            />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-[13px] font-[530] leading-4 text-v2-text-text-base">
              {language.t("server.connect.relay.password")}
            </label>
            <TextInput
              type="password"
              autocomplete="current-password"
              required
              appearance="large"
              value={password()}
              disabled={loading() || connecting()}
              onInput={(e) => setPassword(e.currentTarget.value)}
            />
          </div>
          <Show when={error()}>
            <p class="text-sm text-v2-status-error" role="alert">
              {error()}
            </p>
          </Show>
          <div class="flex gap-2">
            <Button variant="ghost-muted" disabled={loading()} onClick={props.onBack}>
              {language.t("common.cancel")}
            </Button>
            <Button
              variant="contrast"
              disabled={loading() || !relayUrl().trim() || !password()}
              onClick={() => void login()}
            >
              {loading() ? "…" : language.t("server.connect.relay.discover")}
            </Button>
          </div>
        </div>
      </Show>

      <Show when={signedIn()}>
        <div class="flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <h3 class="text-[17px] font-[530] leading-6 tracking-[-0.2px] text-v2-text-text-base">
              {language.t("server.connect.relay.environments")}
            </h3>
            <div class="flex items-center gap-1">
              <Button
                variant="ghost-muted"
                size="small"
                disabled={loading() || connecting()}
                title={language.t("server.connect.relay.refresh")}
                onClick={() => loadEnvironments(relayUrl(), token())}
              >
                <Icon name="refresh" size="small" />
              </Button>
              <Button
                variant="ghost-muted"
                size="small"
                disabled={connecting()}
                onClick={signOut}
              >
                {language.t("server.connect.relay.signOut")}
              </Button>
            </div>
          </div>
          <p class="text-[11px] leading-4 text-v2-text-text-faint">
            {username()} @ {relayUrl()}
          </p>
          <Show when={loading()}>
            <p class="text-[13px] leading-5 text-v2-text-text-faint">
              {language.t("server.connect.relay.discovering")}
            </p>
          </Show>
          <Show when={!loading() && environments().length === 0}>
            <p class="text-[13px] leading-5 text-v2-text-text-faint">
              {language.t("server.connect.relay.noEnvironments")}
            </p>
          </Show>
          <div class="flex flex-col gap-1">
            <For each={environments()}>
              {(env) => {
                const online = () => env.status === ONLINE

                return (
                  <button
                    class="group flex w-full items-center justify-between gap-3 rounded-lg border border-v2-border-border-subtle px-4 py-3 text-left transition-colors hover:bg-v2-overlay-simple-overlay-hover disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={connecting() || !online()}
                    onClick={() => void connectEnv(env)}
                  >
                    <div class="flex min-w-0 flex-1 flex-col gap-1.5">
                      <div class="flex items-center gap-2">
                        <span
                          classList={{
                            "size-1.5 shrink-0 rounded-full": true,
                            "bg-icon-success-base": online(),
                            "bg-icon-critical-base": !online(),
                          }}
                        />
                        <span class="min-w-0 truncate text-[13px] font-[530] leading-4 text-v2-text-text-base">
                          {env.name}
                        </span>
                        <Show when={env.version}>
                          <span class="shrink-0 rounded bg-v2-overlay-simple-overlay-hover px-1.5 py-0.5 text-[10px] leading-4 text-v2-text-text-muted">
                            {env.version}
                          </span>
                        </Show>
                        <span
                          class={`shrink-0 text-[11px] leading-4 ${online() ? "text-v2-text-text-muted" : "text-v2-text-text-faint"}`}
                        >
                          {online()
                            ? language.t("server.connect.relay.status.online")
                            : language.t("server.connect.relay.status.offline")}
                        </span>
                      </div>
                      <div class="flex items-center gap-1.5 text-[11px] leading-4 text-v2-text-text-faint">
                        <Show when={env.hostname}>
                          <span class="truncate">{env.hostname}</span>
                        </Show>
                        <Show when={env.platform}>
                          <span class="shrink-0">·</span>
                          <span class="shrink-0">{env.platform}</span>
                        </Show>
                        <Show when={!online() && env.lastSeenAt ? env.lastSeenAt : undefined}>
                          <span class="shrink-0">·</span>
                          <span class="shrink-0">{lastSeen(env.lastSeenAt ?? 0)}</span>
                        </Show>
                      </div>
                    </div>
                    <Icon name="chevron-right" size="small" class="shrink-0 text-v2-icon-icon-faint" />
                  </button>
                )
              }}
            </For>
          </div>
          <Show when={error()}>
            <p class="text-[13px] leading-5 text-v2-status-error" role="alert">
              {error()}
            </p>
          </Show>
          <Show when={connecting()}>
            <p class="text-[13px] leading-5 text-v2-text-text-faint">
              {language.t("server.connect.relay.connecting")}
            </p>
          </Show>
        </div>
      </Show>
    </div>
  )
}
