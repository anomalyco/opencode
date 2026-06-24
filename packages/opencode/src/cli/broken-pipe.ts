type Exit = (code?: number | string | null | undefined) => never | void

type ErrorLike = {
  code?: unknown
  errno?: unknown
  cause?: unknown
}

export function isBrokenPipeError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false

  const candidate = error as ErrorLike
  if (candidate.code === "EPIPE" || candidate.errno === "EPIPE") return true
  return isBrokenPipeError(candidate.cause)
}

export function exitOnBrokenPipe(error: unknown, exit: Exit = process.exit) {
  if (!isBrokenPipeError(error)) return false
  exit(1)
  return true
}

export function installBrokenPipeHandler(exit: Exit = process.exit) {
  const onError = (error: Error) => {
    if (!exitOnBrokenPipe(error, exit)) throw error
  }

  process.stdout.on("error", onError)
  process.stderr.on("error", onError)

  return () => {
    process.stdout.off("error", onError)
    process.stderr.off("error", onError)
  }
}
