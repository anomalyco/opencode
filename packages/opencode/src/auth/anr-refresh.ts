/**
 * ANR credential refresh system.
 *
 * Handles proactive and reactive refresh of AWS STS credentials
 * obtained via Cognito OIDC in ANR (enterprise) mode.
 *
 * Extracted into its own module to avoid circular imports from index.ts.
 */


const BUFFER_MS = 5 * 60 * 1000 // refresh 5 minutes before expiry

type RefreshFn = () => Promise<{
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
  idToken?: string
  expiration?: Date
  refreshToken?: string
}>

type Credentials = {
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
  idToken?: string
}

let state: {
  stsExpiration: number | undefined
  timer: ReturnType<typeof setTimeout> | undefined
  refreshing: boolean
  refresh: RefreshFn
} | null = null

let listeners: Array<(creds: Credentials) => void> = []

/**
 * Register a listener called whenever ANR credentials are refreshed.
 * Returns an unsubscribe function.
 */
export function onRefresh(listener: (creds: Credentials) => void) {
  listeners.push(listener)
  return () => {
    listeners = listeners.filter((l) => l !== listener)
  }
}

/**
 * Initialize the ANR credential refresh system.
 * Must be called once during ANR startup with the refresh function.
 */
export function init(opts: { stsExpiration: number | undefined; refresh: RefreshFn }) {
  state = {
    stsExpiration: opts.stsExpiration,
    timer: undefined,
    refreshing: false,
    refresh: opts.refresh,
  }
  schedule()
}

/**
 * Check if ANR credentials are expired or about to expire.
 */
export function expired(): boolean {
  if (!state?.stsExpiration) return false
  return Date.now() >= state.stsExpiration - BUFFER_MS
}

/**
 * Refresh ANR AWS credentials.
 * Called proactively by the timer or reactively on expired token errors.
 * Returns true if credentials were refreshed successfully.
 */
export async function refresh(): Promise<boolean> {
  if (!state) return false
  if (state.refreshing) return false
  state.refreshing = true

  try {
    const result = await state.refresh()

    // Update process.env (read by fromEnv() credential provider)
    process.env.AWS_ACCESS_KEY_ID = result.accessKeyId
    process.env.AWS_SECRET_ACCESS_KEY = result.secretAccessKey
    process.env.AWS_SESSION_TOKEN = result.sessionToken
    if (result.idToken) process.env.OPENCODE_ANR_ID_TOKEN = result.idToken

    // Update state
    state.stsExpiration = result.expiration?.getTime()

    // Schedule next refresh
    schedule()

    // Notify listeners (e.g., worker threads)
    const creds: Credentials = {
      accessKeyId: result.accessKeyId,
      secretAccessKey: result.secretAccessKey,
      sessionToken: result.sessionToken,
      idToken: result.idToken,
    }
    for (const listener of listeners) {
      try {
        listener(creds)
      } catch {}
    }

    console.error("🔄 credentials refreshed successfully")
    return true
  } catch (e) {
    console.error("credential refresh failed:", e instanceof Error ? e.message : e)
    return false
  } finally {
    state.refreshing = false
  }
}

function schedule() {
  if (!state?.stsExpiration) return

  if (state.timer) {
    clearTimeout(state.timer)
  }

  const delay = state.stsExpiration - Date.now() - BUFFER_MS
  if (delay <= 0) {
    refresh()
    return
  }

  state.timer = setTimeout(() => {
    refresh()
  }, delay)

  // Prevent timer from keeping the process alive
  if (state.timer.unref) {
    state.timer.unref()
  }
}
