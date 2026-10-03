const LOOPBACK = ["127.0.0.1", "localhost", "::1"]

export function ensureLoopbackNoProxy(env: NodeJS.ProcessEnv = process.env) {
  for (const key of ["NO_PROXY", "no_proxy"]) {
    const items = (env[key] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value !== "")
    for (const host of LOOPBACK) {
      if (items.some((value) => value.toLowerCase() === host)) continue
      items.push(host)
    }
    env[key] = items.join(",")
  }
}
