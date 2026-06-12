export function startTestHttpServer(start: (port: number) => ReturnType<typeof Bun.serve>, attempts = 20) {
  const basePort = 20000 + Math.floor(Math.random() * 20000)
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return start(basePort + attempt)
    } catch (error) {
      lastError = error
      if (!isAddressInUse(error)) throw error
    }
  }

  throw lastError ?? new Error("failed to start test http server")
}

function isAddressInUse(error: unknown) {
  return error instanceof Error && error.message.includes("EADDRINUSE")
}
