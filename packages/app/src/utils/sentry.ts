import * as Sentry from "@sentry/solid"
import { withSentryErrorBoundary } from "@sentry/solid"
import { ErrorBoundary as SolidErrorBoundary } from "solid-js"

// AIDEV-NOTE: Sentry는 Vite production 빌드(=opencode 바이너리에 embed 되어 배포되는
// 정적 자산) 에서만 활성화한다. `bun dev` 로 띄우는 Vite dev 서버는 import.meta.env.PROD 가
// false 라 init 이 스킵된다. 동일 production 번들이 모든 클러스터(dev/prd) 에 배포되므로
// environment 분리는 server 의 /env 라우트가 helm 의 Flag.ENVIRONMENT 를 노출하기 시작하면
// 그때 setTag 로 부착하는 후속 작업으로 처리한다.
const DSN = "https://605a7b9598a30f1afda8a14cd537bf7c@o1200796.ingest.us.sentry.io/4511381321416704"

export namespace SentryReporter {
  let enabled = false

  export function init() {
    if (enabled) return
    if (!import.meta.env.PROD) return

    Sentry.init({
      dsn: DSN,
      sendDefaultPii: false,
      tracesSampleRate: 0,
    })
    enabled = true
  }

  export function isEnabled() {
    return enabled
  }
}

// Solid 의 ErrorBoundary 를 Sentry 의 자동 캡처로 래핑한 컴포넌트.
// Sentry 미초기화 상태에서는 captureException 이 no-op 이라 그대로 일반 ErrorBoundary 처럼 동작.
export const ErrorBoundary = withSentryErrorBoundary(SolidErrorBoundary)
