import { Provider } from "../provider/provider"
import { NamedError } from "@opencode-ai/util/error"
import { NotFoundError } from "../storage/db"
import { Session } from "../session"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import type { ErrorHandler } from "hono"
import { HTTPException } from "hono/http-exception"
import type { Log } from "../util/log"
import { SentryReporter } from "../util/sentry"

export function errorHandler(log: Log.Logger): ErrorHandler {
  return (err, c) => {
    log.error("failed", {
      error: err,
    })
    if (err instanceof NamedError) {
      let status: ContentfulStatusCode
      if (err instanceof NotFoundError) status = 404
      else if (err instanceof Provider.ModelNotFoundError) status = 400
      else if (err.name === "ProviderAuthValidationFailed") status = 400
      else if (err.name.startsWith("Worktree")) status = 400
      else status = 500
      return c.json(err.toObject(), { status })
    }
    if (err instanceof Session.BusyError) {
      return c.json(new NamedError.Unknown({ message: err.message }).toObject(), { status: 400 })
    }
    if (err instanceof HTTPException) return err.getResponse()
    const message = err instanceof Error && err.stack ? err.stack : err.toString()
    // Hono 가 route handler 의 throw 를 자체 try/catch 로 잡아 onError 로 위임하므로
    // 에러는 Bun.serve / process-level 까지 올라오지 않는다. Sentry 의 자동 인스트루멘테이션이
    // 보지 못하는 경로라 수동 캡처가 필요. 위 분기들은 의도된 사용자 에러(4xx)라 노이즈가 되므로
    // unknown 5xx 분기에서만 보고한다.
    SentryReporter.captureException(err, { path: c.req.path, method: c.req.method })
    return c.json(new NamedError.Unknown({ message }).toObject(), {
      status: 500,
    })
  }
}
