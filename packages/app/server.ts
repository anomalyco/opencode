import path from "node:path"
import {
  frontendHealthReport,
} from "./script/frontend-health-runtime"

function envOneOf(names: string[]): string {
  for (const k of names) {
    const v = process.env[k]?.trim()
    if (v) return v
  }
  throw new Error(`Missing required environment variable (set one of): ${names.join(", ")}`)
}

const portRaw = process.env.PORT?.trim()
if (!portRaw || !Number.isFinite(Number(portRaw))) {
  throw new Error("Missing or invalid PORT (must be a number)")
}
const port = Number(portRaw)

const dist = process.env.FRONTEND_DIST_DIR?.trim()
if (!dist) throw new Error("Missing FRONTEND_DIST_DIR")

const root = path.resolve(dist.replace(/\/+$/, ""))

const publicOpencodeServerUrl = envOneOf(["FRONTEND_PUBLIC_OPENCODE_SERVER_URL", "VITE_OPENCODE_SERVER_URL"])
const publicUniverBackendUrl = envOneOf(["FRONTEND_PUBLIC_UNIVER_BACKEND_URL", "VITE_UNIVER_BACKEND_URL"])
const publicRelayWsUrl = envOneOf(["FRONTEND_PUBLIC_UNIVER_SDK_WS", "VITE_UNIVER_SDK_WS"])

function safeJoin(pathname: string) {
  const normalized = pathname === "/" ? "/index.html" : pathname
  const candidate = path.resolve(path.join(root, normalized.replace(/^\/+/, "")))
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return
  return candidate
}

async function serveStatic(pathname: string) {
  const candidate = safeJoin(pathname)
  if (!candidate) return new Response("not found", { status: 404 })

  const filePath = (await Bun.file(candidate).exists()) ? candidate : path.join(root, "index.html")
  const file = Bun.file(filePath)
  if (!(await file.exists())) return new Response("not found", { status: 404 })

  if (filePath.endsWith("index.html")) {
    const html = await file.text()
    const runtimeConfig = {
      opencodeServerUrl: publicOpencodeServerUrl,
      univerBackendUrl: publicUniverBackendUrl,
      univerSdkWsUrl: publicRelayWsUrl,
    }
    const injected = html.replace(
      "</head>",
      `<script>window.__VERITLY_RUNTIME_CONFIG__=${JSON.stringify(runtimeConfig)}</script></head>`,
    )
    return new Response(injected, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache",
      },
    })
  }

  return new Response(file, {
    headers: {
      "content-type": file.type || "application/octet-stream",
      "cache-control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
    },
  })
}

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === "/livez") {
      return new Response("ok", {
        headers: { "content-type": "text/plain; charset=utf-8" },
      })
    }

    if (url.pathname === "/readyz") {
      const report = await frontendHealthReport(root, process.env)
      return new Response(JSON.stringify(report), {
        status: report.ok ? 200 : 503,
        headers: { "content-type": "application/json; charset=utf-8" },
      })
    }

    return serveStatic(url.pathname)
  },
})

console.log(`[veritly-frontend] listening on http://0.0.0.0:${port}`)
