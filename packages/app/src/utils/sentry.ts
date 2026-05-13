import * as Sentry from "@sentry/solid"
import { withSentryErrorBoundary } from "@sentry/solid"
import { ErrorBoundary as SolidErrorBoundary } from "solid-js"

// AIDEV-NOTE: Sentry는 Vite production 빌드(=opencode 바이너리에 embed 되어 배포되는
// 정적 자산) 에서만 활성화한다. `bun dev` 로 띄우는 Vite dev 서버는 import.meta.env.PROD 가
// false 라 init 이 스킵된다.
const DSN = "https://605a7b9598a30f1afda8a14cd537bf7c@o1200796.ingest.us.sentry.io/4511381321416704"

// dev/prd 클러스터 구분값. init 시점에는 비어있고 server `/env` 응답 후 setEnvironment 로 채워진다.
let currentEnvironment: string | undefined

export namespace SentryReporter {
  let enabled = false

  export function init() {
    if (enabled) return
    if (!import.meta.env.PROD) return

    Sentry.init({
      dsn: DSN,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      // environment 를 Sentry.init 옵션으로 직접 넘기지 않고 beforeSend 훅에서 동적으로 채우는 이유:
      //
      //   1. 값의 출처가 server 의 helm 주입 env (Flag.ENVIRONMENT) 라 브라우저 번들엔 안 들어옴.
      //      동일 production 번들이 dev/prd 두 클러스터에 동일하게 배포되므로 Vite define 등
      //      빌드타임 주입으론 구분 불가. 런타임에 `/env` 라우트로 받아야 한다.
      //   2. `/env` 응답은 비동기인데 Sentry init 은 모듈 로드 직후 다른 코드 import 전에
      //      동기적으로 끝내야 초기 에러까지 잡을 수 있다. 응답 기다리면 그 윈도우의 에러 누락.
      //   3. Sentry SDK v10 은 init 이후 environment 를 변경하는 공식 API 를 노출하지 않는다.
      //      `setTag("environment", ...)` 는 tags 필드에 추가될 뿐 event.environment 와 별개라
      //      Sentry UI 상단의 environment 드롭다운 필터에 잡히지 않는다.
      //      prepareEvent 의 `event.environment = event.environment || options.environment || DEFAULT`
      //      규칙을 이용해, beforeSend 에서 event.environment 를 직접 채우는 게 정공법.
      //
      // 호출 전 짧은 윈도우(수십 ms)의 이벤트는 SDK 기본값 "production" 으로 잡힌다.
      // 정밀하게 가르려면 server 가 index.html 에 inline <script> 로 환경을 sync 주입하는 구조
      // 변경이 필요한데, 정적 자산 서빙 단순함을 깨뜨려 트레이드오프상 채택 안 함.
      beforeSend(event) {
        if (currentEnvironment) event.environment = currentEnvironment
        return event
      },
    })
    enabled = true
  }

  export function setEnvironment(env: string) {
    currentEnvironment = env
  }

  export function isEnabled() {
    return enabled
  }
}

// Solid 의 ErrorBoundary 를 Sentry 의 자동 캡처로 래핑한 컴포넌트.
// Sentry 미초기화 상태에서는 captureException 이 no-op 이라 그대로 일반 ErrorBoundary 처럼 동작.
export const ErrorBoundary = withSentryErrorBoundary(SolidErrorBoundary)
