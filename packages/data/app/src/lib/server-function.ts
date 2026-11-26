import type { createMiddleware } from "@solidjs/start/middleware"

type Middleware = ReturnType<typeof createMiddleware>[number]

export type ServerFunctionFailure =
  | { kind: "retired_function" }
  | { kind: "payload_too_large" }
  | { kind: "malformed_request" }
  | { kind: "unexpected" }

// SolidStart's runServerFunction (v2.1.0) looks up the server function id and deserializes GET args
// and POST bodies outside its try/catch, so stale client tabs calling retired function ids and
// malformed payloads bubble out as unhandled 500s. Map those client errors to 4xx while letting
// unexpected errors remain 500s.
export const serverFunctionErrors: Middleware = async (event, next) => {
  const pathname = new URL(event.req.url).pathname
  if (pathname !== "/data/_server" && !pathname.startsWith("/data/_server/")) return next()
  try {
    return await next()
  } catch (error) {
    const response = serverFunctionErrorResponse(error)
    if (response) return response
    throw error
  }
}

export function classifyServerFunctionError(error: unknown): ServerFunctionFailure {
  if (!(error instanceof Error)) return { kind: "unexpected" }
  if (error.message.startsWith("invalid server function:")) return { kind: "retired_function" }
  if (error.message.startsWith("Server function stream chunk of ")) return { kind: "payload_too_large" }
  if (
    error.message === "Malformed server function stream." ||
    error.message.startsWith("Seroval Error") ||
    error.name.startsWith("Seroval") ||
    error.message === "missing body" ||
    error instanceof SyntaxError ||
    (error instanceof TypeError && /not iterable|formdata|boundary|multipart/i.test(error.message))
  ) {
    return { kind: "malformed_request" }
  }
  return { kind: "unexpected" }
}

export function serverFunctionErrorResponse(error: unknown): Response | undefined {
  const failure = classifyServerFunctionError(error)
  switch (failure.kind) {
    case "retired_function":
      return errorResponse(410)
    case "payload_too_large":
      return errorResponse(413)
    case "malformed_request":
      return errorResponse(400)
    case "unexpected":
      return undefined
  }
}

// X-Error makes @solidjs/start's fetchServerFunction throw instead of returning undefined.
function errorResponse(status: 400 | 410 | 413) {
  return new Response(null, {
    status,
    headers: { "Cache-Control": "no-store", "X-Error": "true" },
  })
}
