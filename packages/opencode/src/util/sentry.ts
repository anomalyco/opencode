import * as SentryBun from "@sentry/bun"
import { Flag } from "../flag/flag"
import { Installation } from "../installation"

// AIDEV-NOTE: Sentry는 JupyterHub 싱글유저 파드(=배포 환경)에서만 활성화한다.
// JUPYTERHUB_API_URL 은 JupyterHub Spawner 가 컨테이너에 자동 주입하는 표시자이므로
// 로컬/CLI/npm 배포 등에서는 비어 있어 자연스럽게 비활성화된다.
// hub-auth.ts 의 isHubMode 와 동일한 게이팅 시그널을 사용한다.
const DSN = "https://e22b8291293e6d85e775ae7313a804d3@o1200796.ingest.us.sentry.io/4511380949565440"

export namespace SentryReporter {
  let enabled = false

  export function init() {
    if (enabled) return
    if (!Flag.JUPYTERHUB_API_URL) return
    const disabled = process.env["OPENCODE_SENTRY_DISABLED"]?.toLowerCase()
    if (disabled === "1" || disabled === "true") return

    SentryBun.init({
      dsn: DSN,
      environment: process.env["OPENCODE_SENTRY_ENVIRONMENT"] ?? "production",
      release: process.env["OPENCODE_SENTRY_RELEASE"] ?? Installation.VERSION,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      initialScope: {
        user: Flag.JUPYTERHUB_USER ? { username: Flag.JUPYTERHUB_USER } : undefined,
        tags: {
          channel: Installation.CHANNEL,
          ...(Flag.OPENCODE_SERVE_DOMAIN ? { serveDomain: Flag.OPENCODE_SERVE_DOMAIN } : {}),
        },
      },
    })
    enabled = true
  }

  export function captureException(error: unknown, context?: Record<string, unknown>) {
    if (!enabled) return
    SentryBun.captureException(error, context ? { extra: context } : undefined)
  }

  export function isEnabled() {
    return enabled
  }
}
