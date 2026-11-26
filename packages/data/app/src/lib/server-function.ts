import type { createMiddleware } from "@solidjs/start/middleware"

type Middleware = ReturnType<typeof createMiddleware>[number]

// SolidStart's runServerFunction (v2.1.0) looks up the server function id and deserializes GET args
// and POST bodies outside its try/catch, so stale client tabs calling retired function ids and
// malformed payloads bubble out as unhandled 500s. Map those client errors to 4xx while letting
// unexpected errors remain 500s.
export const serverFunctionErrors: Middleware = async (event, next) => {
  if (!new URL(event.req.url).pathname.startsWith("/data/_server")) return next()
  try {
    return await next()
  } catch (error) {
    const response = serverFunctionErrorResponse(error)
    if (response) return response
    throw error
  }
}

export function serverFunctionErrorResponse(error: unknown): Response | undefined {
  if (!(error instanceof Error)) return undefined
  const status = statusFor(error)
  if (!status) return undefined
  // X-Error makes @solidjs/start's fetchServerFunction throw instead of returning undefined.
  return new Response(null, {
    status,
    headers: { "Cache-Control": "no-store", "X-Error": "true" },
  })
}

function statusFor(error: Error) {
  if (error.message.startsWith("invalid server function:")) return 410
  if (error.message.startsWith("Server function stream chunk of ")) return 413
  if (
    error.message === "Malformed server function stream." ||
    error.message.startsWith("Seroval Error") ||
    error.name.startsWith("Seroval") ||
    error.message === "missing body" ||
    error instanceof SyntaxError ||
    (error instanceof TypeError && /not iterable|formdata|boundary|multipart/i.test(error.message))
  ) {
    return 400
  }
  return undefined
}
