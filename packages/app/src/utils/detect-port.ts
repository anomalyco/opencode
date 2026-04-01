type SDK = {
  file: { read: (input: { path: string }) => Promise<{ data?: { content?: string; type?: string } }> }
}

type Result = {
  url: string
  framework?: string
}

const FRAMEWORKS: Record<string, { port: number; name: string }> = {
  vite: { port: 5173, name: "Vite" },
  next: { port: 3000, name: "Next.js" },
  nuxt: { port: 3000, name: "Nuxt" },
  "react-scripts": { port: 3000, name: "Create React App" },
  "webpack-dev-server": { port: 8080, name: "Webpack" },
  "webpack serve": { port: 8080, name: "Webpack" },
  astro: { port: 4321, name: "Astro" },
  remix: { port: 3000, name: "Remix" },
  svelte: { port: 5173, name: "SvelteKit" },
  turbo: { port: 3000, name: "Turborepo" },
  bun: { port: 3000, name: "Bun" },
  tsx: { port: 3000, name: "TSX" },
}

const PROBE_PORTS = [3000, 5173, 3001, 4321, 8080, 8000, 4200, 4173, 5174, 8888]

function extractPort(script: string): number | undefined {
  const match = script.match(/--port\s+(\d+)/) ?? script.match(/-p\s+(\d+)/) ?? script.match(/PORT[=:]\s*(\d+)/)
  if (match) return parseInt(match[1], 10)
  return undefined
}

function detect(scripts: Record<string, string>): { port: number; framework: string } | undefined {
  const dev = scripts.dev ?? scripts.start ?? ""
  if (!dev) return undefined

  for (const [key, info] of Object.entries(FRAMEWORKS)) {
    if (dev.includes(key)) {
      const port = extractPort(dev) ?? info.port
      return { port, framework: info.name }
    }
  }

  return undefined
}

async function probePort(port: number): Promise<boolean> {
  try {
    await fetch(`http://localhost:${port}`, { method: "HEAD", mode: "no-cors", signal: AbortSignal.timeout(2500) })
    return true
  } catch {
    try {
      await fetch(`http://127.0.0.1:${port}`, { method: "HEAD", mode: "no-cors", signal: AbortSignal.timeout(2500) })
      return true
    } catch {
      return false
    }
  }
}

async function probe(ports: number[]): Promise<string | undefined> {
  // Race all ports but with individual fallback per port
  try {
    return await Promise.any(
      ports.map(async (port) => {
        const ok = await probePort(port)
        if (!ok) throw new Error("unreachable")
        return `http://localhost:${port}`
      }),
    )
  } catch {
    return undefined
  }
}

export async function detectDevUrl(_directory: string, client: SDK): Promise<Result | null> {
  // 1. Try package.json detection (path is relative — SDK client has directory context)
  let ports: number[] | undefined
  try {
    const res = await client.file.read({ path: "package.json" })
    if (res.data?.content) {
      const pkg = JSON.parse(res.data.content)
      const scripts = pkg.scripts as Record<string, string> | undefined
      if (scripts) {
        const found = detect(scripts)
        if (found) {
          console.log("[Design] Detected framework:", found.framework, "port:", found.port)
          // Probe the detected port first, then fall back to all ports
          const ok = await probePort(found.port)
          if (ok) return { url: `http://localhost:${found.port}`, framework: found.framework }
          // The framework port isn't responding — prioritize it but try others too
          ports = [found.port, ...PROBE_PORTS.filter((p) => p !== found.port)]
        }
      }
    }
  } catch (e) {
    console.log("[Design] package.json read failed:", e)
  }

  // 2. Probe common ports
  console.log("[Design] Probing ports:", (ports ?? PROBE_PORTS).join(", "))
  const url = await probe(ports ?? PROBE_PORTS)
  if (url) {
    console.log("[Design] Found dev server at:", url)
    return { url }
  }

  console.log("[Design] No dev server found")
  return null
}
