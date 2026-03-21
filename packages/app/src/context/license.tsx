import { createSimpleContext } from "@opencode-ai/ui/context"
import { createMemo, createEffect } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"
import { usePlatform } from "@/context/platform"

export type LicensePhase = "checking" | "missing" | "active" | "grace" | "invalid" | "expired" | "error"

type PersistedState = {
  installID: string
  state: "missing" | "active" | "invalid" | "expired"
  licenseKey?: string
  maskedKey?: string
  plan?: string
  entitlementToken?: string
  refreshToken?: string
  lastValidatedAt?: string
  expiresAt?: string
  graceUntil?: string
  nextCheckAt?: string
}

type RuntimeState = {
  ready: boolean
  busy: boolean
  phase: LicensePhase
  message?: string
}

type ActionResult = {
  ok: boolean
  phase: LicensePhase
  message?: string
}

type ResponseState = Exclude<PersistedState["state"], "missing">

declare global {
  interface Window {
    __OPENCODE__?: {
      updaterEnabled?: boolean
      serverPassword?: string
      deepLinks?: string[]
      licenseUrl?: string
    }
  }
}

const DAY = 1000 * 60 * 60 * 24

function uid(): string {
  return crypto.randomUUID?.() ?? Math.random().toString(16).slice(2)
}

function defaults(installID: string = uid()): PersistedState {
  return {
    installID,
    state: "missing",
  }
}

function stamp(value?: string) {
  if (!value) return
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return
  return time
}

function pickText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function pickField(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object") return
  for (const key of keys) {
    const text = pickText((value as Record<string, unknown>)[key])
    if (text) return text
  }
}

function phaseOf(value: PersistedState): LicensePhase {
  const now = Date.now()
  const expires = stamp(value.expiresAt)
  if (expires && now <= expires) return "active"
  const grace = stamp(value.graceUntil)
  if (grace && now <= grace) return "grace"
  if (value.state === "invalid") return "invalid"
  if (value.state === "expired") return "expired"
  const hasLicense = !!(
    value.licenseKey ||
    value.maskedKey ||
    value.plan ||
    value.entitlementToken ||
    value.refreshToken ||
    value.lastValidatedAt ||
    value.expiresAt ||
    value.graceUntil
  )
  if (value.state === "active" && hasLicense) return "active"
  if (hasLicense) return "expired"
  return "missing"
}

function nextCheck(input: { nextCheckAt?: string; expiresAt?: string }) {
  const explicit = stamp(input.nextCheckAt)
  if (explicit) return new Date(explicit).toISOString()
  const now = Date.now()
  const expires = stamp(input.expiresAt)
  if (expires) return new Date(Math.min(expires, now + DAY)).toISOString()
  return new Date(now + DAY).toISOString()
}

function normalize(input: unknown): { state: ResponseState; data: Partial<PersistedState>; message?: string } {
  const state = pickField(input, ["status", "state"])
  const maskedKey = pickField(input, ["masked_key", "maskedKey"])
  const plan = pickField(input, ["plan", "tier"])
  const entitlementToken = pickField(input, ["entitlement_token", "entitlementToken"])
  const refreshToken = pickField(input, ["refresh_token", "refreshToken"])
  const lastValidatedAt = pickField(input, ["last_validated_at", "lastValidatedAt", "checked_at", "checkedAt"])
  const expiresAt = pickField(input, ["expires_at", "expiresAt"])
  const graceUntil = pickField(input, ["grace_until", "graceUntil"])
  const nextCheckAt = pickField(input, ["next_check_at", "nextCheckAt"])
  const message = pickField(input, ["message", "detail", "error"])

  const value = state === "invalid" || state === "expired" ? state : "active"
  return {
    state: value,
    message,
    data: {
      maskedKey,
      plan,
      entitlementToken,
      refreshToken,
      lastValidatedAt: lastValidatedAt ?? new Date().toISOString(),
      expiresAt,
      graceUntil,
      nextCheckAt: nextCheck({ nextCheckAt, expiresAt }),
    },
  }
}

export const { use: useLicense, provider: LicenseProvider } = createSimpleContext({
  name: "License",
  init: () => {
    const platform = usePlatform()
    const [saved, setSaved, _, ready] = persisted(
      Persist.global("license", ["license.v1"]),
      createStore<PersistedState>(defaults()),
    )
    const [state, setState] = createStore<RuntimeState>({
      ready: false,
      busy: false,
      phase: "checking",
      message: undefined,
    })

    const fetcher = platform.fetch ?? globalThis.fetch
    const configured = () => {
      const runtime = typeof window === "object" ? window.__OPENCODE__?.licenseUrl : undefined
      const env = import.meta.env.VITE_OPENCODE_LICENSE_URL?.trim()
      const raw = runtime?.trim() || env || (typeof window === "object" ? window.location.origin : undefined)
      if (!raw) return
      return raw.replace(/\/+$/, "")
    }

    const cached = createMemo(() => phaseOf(saved))
    const licensed = createMemo(() => state.phase === "active" || state.phase === "grace")
    const canRefresh = createMemo(() => !!saved.licenseKey || !!saved.refreshToken || !!saved.entitlementToken)

    const reset = (value: PersistedState["state"] = "missing", next?: Partial<PersistedState>) => {
      setSaved(
        reconcile({
          ...defaults(saved.installID),
          state: value,
          licenseKey: next?.licenseKey,
          maskedKey: next?.maskedKey,
          plan: next?.plan,
          lastValidatedAt: next?.lastValidatedAt,
          expiresAt: next?.expiresAt,
          graceUntil: next?.graceUntil,
          nextCheckAt: next?.nextCheckAt,
        }),
      )
    }

    const apply = (input: { state: ResponseState; data: Partial<PersistedState>; message?: string }) => {
      if (input.state === "active") {
        setSaved(
          reconcile({
            ...saved,
            state: input.state,
            maskedKey: input.data.maskedKey ?? saved.maskedKey,
            plan: input.data.plan,
            entitlementToken: input.data.entitlementToken,
            refreshToken: input.data.refreshToken,
            lastValidatedAt: input.data.lastValidatedAt,
            expiresAt: input.data.expiresAt,
            graceUntil: input.data.graceUntil,
            nextCheckAt: input.data.nextCheckAt,
          }),
        )
        const phase = phaseOf({
          ...saved,
          state: input.state,
          maskedKey: input.data.maskedKey ?? saved.maskedKey,
          plan: input.data.plan,
          entitlementToken: input.data.entitlementToken,
          refreshToken: input.data.refreshToken,
          lastValidatedAt: input.data.lastValidatedAt,
          expiresAt: input.data.expiresAt,
          graceUntil: input.data.graceUntil,
          nextCheckAt: input.data.nextCheckAt,
        })
        setState("phase", phase)
        setState("message", undefined)
        return { ok: true, phase } satisfies ActionResult
      }

      reset(input.state, {
        maskedKey: input.data.maskedKey ?? saved.maskedKey,
        plan: input.data.plan ?? saved.plan,
        lastValidatedAt: input.data.lastValidatedAt ?? saved.lastValidatedAt,
        expiresAt: input.data.expiresAt ?? saved.expiresAt,
        graceUntil: input.data.graceUntil ?? saved.graceUntil,
        nextCheckAt: input.data.nextCheckAt,
      })
      setState("phase", input.state)
      setState("message", input.message)
      return { ok: false, phase: input.state, message: input.message } satisfies ActionResult
    }

    const post = (path: string, body: Record<string, unknown>) => {
      const url = configured()
      if (!url) {
        return Promise.resolve({
          ok: false,
          status: 0,
          message: "License service is not configured.",
          data: undefined as unknown,
        })
      }

      return fetcher(`${url}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
        .then(async (response) => {
          const text = await response.text().catch(() => "")
          const data = (() => {
            if (!text) return undefined
            try {
              return JSON.parse(text) as unknown
            } catch {
              return undefined
            }
          })()
          const message = pickField(data, ["message", "detail", "error"]) ?? (text || undefined)
          return {
            ok: response.ok,
            status: response.status,
            message,
            data,
          }
        })
        .catch((error: unknown) => ({
          ok: false,
          status: 0,
          message: error instanceof Error ? error.message : String(error),
          data: undefined as unknown,
        }))
    }

    const request = (path: string, body: Record<string, unknown>) =>
      post(path, {
        install_id: saved.installID,
        app_version: platform.version,
        platform: platform.platform,
        os: platform.os,
        ...body,
      })

    const finish = (result: ActionResult) => {
      setState("busy", false)
      setState("ready", true)
      return result
    }

    const refresh = (opts?: { silent?: boolean }) => {
      const phase = cached()
      if (!canRefresh()) {
        const next = { ok: licensed(), phase, message: state.message } satisfies ActionResult
        if (!opts?.silent) setState("phase", phase)
        setState("busy", false)
        setState("ready", true)
        return Promise.resolve(next)
      }

      if (!opts?.silent || !licensed()) setState("phase", "checking")
      setState("busy", true)
      setState("message", undefined)

      const path = saved.refreshToken ? "/v1/licenses/refresh" : "/v1/licenses/activate"
      const body = saved.refreshToken
        ? {
            entitlement_token: saved.entitlementToken,
            refresh_token: saved.refreshToken,
          }
        : {
            license_key: saved.licenseKey,
          }

      return request(path, body).then((response) => {
        if (response.ok) return finish(apply(normalize(response.data)))

        if (licensed()) {
          setState("phase", phase)
          setState("message", response.message ?? "We couldn't refresh your license right now.")
          return finish({ ok: true, phase, message: response.message })
        }

        const next = saved.state === "expired" || phase === "expired" ? "expired" : "error"
        setState("phase", next)
        setState("message", response.message ?? "We couldn't verify your license.")
        return finish({ ok: false, phase: next, message: response.message })
      })
    }

    const activate = (key: string) => {
      const value = key.trim()
      if (!value) return Promise.resolve({ ok: false, phase: state.phase, message: "Enter a license key." } satisfies ActionResult)

      setState("busy", true)
      setState("phase", "checking")
      setState("message", undefined)

      return request("/v1/licenses/activate", { license_key: value }).then((response) => {
        if (response.ok) {
          const result = apply(normalize(response.data))
          setSaved("licenseKey", value)
          return finish(result)
        }

        const phase = response.status >= 400 && response.status < 500 ? "invalid" : "error"
        setState("phase", phase)
        setState("message", response.message ?? (phase === "invalid" ? "This license key isn't valid." : "We couldn't verify your license."))
        return finish({ ok: false, phase, message: response.message })
      })
    }

    let booted = false
    createEffect(() => {
      if (!ready()) return
      if (booted) return
      booted = true

      const phase = cached()
      const due = (() => {
        const next = stamp(saved.nextCheckAt)
        if (!next) return phase === "expired" || phase === "grace"
        return Date.now() >= next
      })()

      setState("phase", phase)

      if (!due) {
        setState("ready", true)
        return
      }

      if (phase === "active" || phase === "grace") {
        setState("ready", true)
        void refresh({ silent: true })
        return
      }

      void refresh()
    })

    return {
      ready: () => state.ready,
      busy: () => state.busy,
      phase: () => state.phase,
      message: () => state.message,
      licensed,
      canRefresh,
      get maskedKey() {
        return saved.maskedKey
      },
      get plan() {
        return saved.plan
      },
      get lastValidatedAt() {
        return saved.lastValidatedAt
      },
      get expiresAt() {
        return saved.expiresAt
      },
      get graceUntil() {
        return saved.graceUntil
      },
      activate,
      refresh,
      clear() {
        reset()
        setState("phase", "missing")
        setState("message", undefined)
        setState("ready", true)
      },
    }
  },
})
