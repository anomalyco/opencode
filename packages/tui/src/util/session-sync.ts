import { ClientError, isUnknownError } from "@opencode/client"
import { isTransientError, retry } from "@opencode/util/retry"
import { Option, Schema } from "effect"

const status = Schema.decodeUnknownOption(Schema.Struct({ status: Schema.Number }))

export function retrySessionSync(operation: () => Promise<void>, signal: AbortSignal) {
  return retry(operation, {
    attempts: 5,
    signal,
    retryIf: (error) => {
      if (isUnknownError(error)) return true
      if (!(error instanceof ClientError)) return false
      if (error.reason === "Transport") return isTransientError(error)
      if (error.reason !== "UnexpectedStatus") return false
      const response = status(error.cause)
      return (
        Option.isSome(response) &&
        (response.value.status === 408 ||
          response.value.status === 429 ||
          (response.value.status >= 500 && response.value.status < 600))
      )
    },
  })
}
