export function sshServerIdsToStartOnInitialize(servers: { id: string }[]) {
  return servers.map((server) => server.id)
}

export async function pollSshHealth(check: () => Promise<boolean>, signal: AbortSignal, interval = 250) {
  while (!signal.aborted) {
    if (await check()) return
    await abortableDelay(interval, signal)
  }
}

function abortableDelay(duration: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timeout)
      signal.removeEventListener("abort", done)
      resolve()
    }
    const timeout = setTimeout(done, duration)
    signal.addEventListener("abort", done, { once: true })
  })
}
