import * as SentryBun from "@sentry/bun"
import { Flag } from "../flag/flag"

// AIDEV-NOTE: Sentry는 JupyterHub 싱글유저 파드(=배포 환경)에서만 활성화한다.
// JUPYTERHUB_API_URL 은 JupyterHub Spawner 가 컨테이너에 자동 주입하는 표시자이므로
// 로컬/CLI/npm 배포 등에서는 비어 있어 자연스럽게 비활성화된다.
// hub-auth.ts 의 isHubMode 와 동일한 게이팅 시그널을 사용한다.
//
// environment 는 helm 이 주입하는 ENVIRONMENT env var 를 사용한다 (jce-jupyter-hub-helm
// 컨벤션과 동일: dev/prd 클러스터에서 각각 "development"/"production" 주입).
// release 는 빌드 시 OPENCODE_VERSION 이 모든 빌드에 "0.0.0-enk" 로 동일하게 박혀 있어
// 의미가 없으므로 설정하지 않는다. 빌드 시 git SHA 가 inject 되면 그때 추가.
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
      environment: Flag.ENVIRONMENT,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      initialScope: {
        user: Flag.JUPYTERHUB_USER ? { username: Flag.JUPYTERHUB_USER } : undefined,
        tags: {
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
