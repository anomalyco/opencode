export function ensureLoopbackNoProxy() {
  const loopback = ["127.0.0.1", "localhost", "::1"]

  ;["NO_PROXY", "no_proxy"].forEach((key) => {
    const items = (process.env[key] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)

    loopback.forEach((host) => {
      if (!items.some((value) => value.toLowerCase() === host)) items.push(host)
    })
    process.env[key] = items.join(",")
  })
}
