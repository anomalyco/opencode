import { Option, Schema } from "effect"
import { Json } from "./json.js"
import { isRecord } from "./record.js"

const decodeJson = Schema.decodeUnknownOption(Json)

/** Error codes a provider error body carries, in their original case. The first is its primary code (`AIError.code`). */
export function providerCodes(value: unknown) {
  const decoded = typeof value === "string" ? Option.getOrUndefined(decodeJson(value)) : value
  if (!isRecord(decoded)) return []
  const error = isRecord(decoded.error) ? decoded.error : undefined
  const inner = error && isRecord(error.innererror) ? error.innererror : undefined
  const metadata = error && isRecord(error.metadata) ? error.metadata : undefined
  const response = isRecord(decoded.response) ? decoded.response : undefined
  const responseError = response && isRecord(response.error) ? response.error : undefined
  const exception = isRecord(decoded.exception) ? decoded.exception : undefined
  return [
    decoded.code,
    ...awsErrorType(decoded.__type),
    ...awsErrorType(decoded.code),
    decoded.error_type,
    error?.code,
    error?.type,
    error?.status,
    error?.error_type,
    // Google `google.rpc.ErrorInfo` details carry the specific reason.
    ...(Array.isArray(error?.details)
      ? error.details.map((detail) => (isRecord(detail) ? detail.reason : undefined))
      : []),
    inner?.code,
    metadata?.error_type,
    responseError?.code,
    response?.error_type,
    exception?.type,
  ].filter((value): value is string => typeof value === "string")
}

// AWS restJson1 reports the modeled error in `X-Amzn-Errortype`, `__type` or `code`, possibly
// namespaced (`ns#Name`) or suffixed (`Name:uri`). Keep the shape name only.
// https://smithy.io/2.0/aws/protocols/aws-restjson1-protocol.html#operation-error-serialization
export function awsErrorType(value: unknown) {
  return typeof value === "string" ? [value.replace(/:.*/s, "").replace(/^[^#]*#/, "")] : []
}
