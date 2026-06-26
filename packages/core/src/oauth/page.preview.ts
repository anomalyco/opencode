// Dev-only preview for the OAuth callback pages.
//
//   bun packages/core/src/oauth/page.preview.ts
//   PORT=5000 bun packages/core/src/oauth/page.preview.ts
//
// Shows a before/after for every integration: the old per-integration page on the
// left, the new unified page (from ./page) on the right. New pages use the real
// render functions, so what you see is what ships. The bootstrap showcase runs the
// real fragment-relay script against a stub /preview/token endpoint.

import { success, error, bootstrap } from "./page"

const SAMPLE_ERROR = "invalid_grant: authorization code expired"

const longError = [
  "invalid_grant: the authorization code has expired or was already redeemed.",
  "",
  "request-id: 7f3a2b9c-1d4e-4f8a-9c2b-6e5d0a1b2c3d",
  "Try signing in again. If it keeps failing, check that your system clock is correct.",
  `escaping check: <script>alert("xss")</script> & 'quotes'`,
].join("\n")

// Each integration: its old page (faithful snapshot of what shipped) and the
// provider label fed to the new unified page.
const INTEGRATIONS: { id: string; label: string; file: string; provider: string; legacy: LegacyPages }[] = [
  {
    id: "mcp",
    label: "MCP",
    file: "packages/opencode/src/mcp/oauth-callback.ts",
    provider: "MCP",
    legacy: legacyMcp(),
  },
  { id: "openai-v2", label: "OpenAI / ChatGPT (Effect v2)", file: "packages/core/src/plugin/provider/openai.ts", provider: "ChatGPT", legacy: legacyOpenai() }, // prettier-ignore
  { id: "codex", label: "Codex / ChatGPT (legacy v1)", file: "packages/opencode/src/plugin/openai/codex.ts", provider: "Codex", legacy: legacyEmber("Codex") }, // prettier-ignore
  {
    id: "xai",
    label: "xAI (Grok)",
    file: "packages/opencode/src/plugin/xai.ts",
    provider: "xAI",
    legacy: legacyEmber("xAI"),
  },
  { id: "snowflake", label: "Snowflake Cortex", file: "packages/opencode/src/plugin/snowflake-cortex.ts", provider: "Snowflake", legacy: legacySnowflake() }, // prettier-ignore
  { id: "digitalocean", label: "DigitalOcean", file: "packages/opencode/src/plugin/digitalocean.ts", provider: "DigitalOcean", legacy: legacyDigitalOcean() }, // prettier-ignore
]

const SHOWCASE: Record<string, { render: () => string; hash?: string }> = {
  "success-light": { render: () => success({ provider: "GitHub" }) },
  "error-long": { render: () => error(longError, { provider: "Snowflake" }) },
  "bootstrap-ok": {
    render: () => bootstrap({ tokenPath: "/preview/token", provider: "DigitalOcean" }),
    hash: "#access_token=demo-token&state=preview&expires_in=3600",
  },
  "bootstrap-fail": {
    render: () => bootstrap({ tokenPath: "/preview/token", provider: "DigitalOcean" }),
    hash: "#error=access_denied&error_description=The%20user%20denied%20the%20request",
  },
}

const HTML_HEADERS = { "Content-Type": "text/html; charset=utf-8" }

const server = Bun.serve({
  port: Number(process.env.PORT ?? 4561),
  fetch(request) {
    const url = new URL(request.url)
    const segments = url.pathname.split("/").filter(Boolean)

    if (request.method === "POST" && url.pathname === "/preview/token") return Response.json({ ok: true })

    if (url.pathname === "/") return new Response(gallery(), { headers: HTML_HEADERS })

    // /legacy/<id>/<success|error>
    if (segments[0] === "legacy" && segments.length === 3) {
      const integration = INTEGRATIONS.find((entry) => entry.id === segments[1])
      if (!integration) return new Response("Not found", { status: 404 })
      const page = segments[2] === "error" ? integration.legacy.error(SAMPLE_ERROR) : integration.legacy.success
      return new Response(page, { headers: HTML_HEADERS })
    }

    // /new/<id>/<success|error>?theme=
    if (segments[0] === "new" && segments.length === 3) {
      const integration = INTEGRATIONS.find((entry) => entry.id === segments[1])
      if (!integration) return new Response("Not found", { status: 404 })
      const page =
        segments[2] === "error"
          ? error(SAMPLE_ERROR, { provider: integration.provider })
          : success({ provider: integration.provider })
      return new Response(withTheme(page, url.searchParams.get("theme")), { headers: HTML_HEADERS })
    }

    // /page/<showcase>?theme=
    if (segments[0] === "page" && segments.length === 2) {
      const variant = SHOWCASE[segments[1]]
      if (!variant) return new Response("Not found", { status: 404 })
      return new Response(withTheme(variant.render(), url.searchParams.get("theme")), { headers: HTML_HEADERS })
    }

    return new Response("Not found", { status: 404 })
  },
})

console.log(`\n  opencode OAuth callback preview → http://localhost:${server.port}\n`)

function withTheme(html: string, theme: string | null) {
  if (theme !== "light" && theme !== "dark") return html
  return html.replace(`<html lang="en">`, `<html lang="en" data-theme="${theme}">`)
}

function frame(label: string, src: string, kind?: "before" | "after") {
  return `<figure${kind ? ` class="${kind}"` : ""}><figcaption>${label}</figcaption><iframe src="${src}" loading="lazy"></iframe></figure>`
}

function gallery() {
  const comparisons = INTEGRATIONS.map(
    (entry) => `<section>
        <h2>${entry.label}<code>${entry.file}</code></h2>
        <div class="grid2">
          ${frame("Before · success", `/legacy/${entry.id}/success`, "before")}
          ${frame("After · success", `/new/${entry.id}/success?theme=dark`, "after")}
          ${frame("Before · error", `/legacy/${entry.id}/error`, "before")}
          ${frame("After · error", `/new/${entry.id}/error?theme=dark`, "after")}
        </div>
      </section>`,
  ).join("")

  const showcase = `<section>
      <h2>New design — light &amp; dark, plus the fragment-relay flow</h2>
      <div class="grid2">
        ${frame("Success · light", `/new/mcp/success?theme=light`)}
        ${frame("Success · dark", `/new/mcp/success?theme=dark`)}
        ${frame("Long / escaped error · light", `/page/error-long?theme=light`)}
        ${frame("Long / escaped error · dark", `/page/error-long?theme=dark`)}
        ${frame("Bootstrap → success · dark", `/page/bootstrap-ok?theme=dark${SHOWCASE["bootstrap-ok"]?.hash ?? ""}`)}
        ${frame("Bootstrap → error · dark", `/page/bootstrap-fail?theme=dark${SHOWCASE["bootstrap-fail"]?.hash ?? ""}`)}
      </div>
    </section>`

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>opencode OAuth callback — before / after</title>
    <style>${GALLERY_STYLES}</style>
  </head>
  <body>
    <header>
      <h1>opencode — OAuth callback pages</h1>
      <p>Before (the old per-integration page) vs after (the new unified page). The "after" pages render from the real <code>./page</code> module. New pages here are shown in dark to match the old dark-only pages; the last section shows the new design's light/dark range and the live fragment-relay flow.</p>
    </header>
    <main>${comparisons}${showcase}</main>
  </body>
</html>`
}

const GALLERY_STYLES = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px; background: #0d0d0d; color: #e6e6e6; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  header { max-width: 1100px; margin: 0 auto 28px; }
  header h1 { margin: 0 0 8px; font-size: 20px; }
  header p { margin: 0; max-width: 86ch; color: #9a9a9a; font-size: 14px; line-height: 1.6; }
  header code { color: #c9c9c9; font-size: 12.5px; }
  main { max-width: 1100px; margin: 0 auto; display: grid; gap: 28px; }
  section { padding: 18px; background: #141414; border: 1px solid #232323; border-radius: 14px; }
  section h2 { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin: 0 0 14px; font-size: 14px; font-weight: 600; color: #e6e6e6; }
  section h2 code { font-size: 11.5px; font-weight: 400; color: #7c7c7c; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  @media (max-width: 820px) { .grid2 { grid-template-columns: 1fr; } }
  figure { margin: 0; overflow: hidden; background: #1a1a1a; border: 1px solid #232323; border-radius: 12px; }
  figcaption { padding: 8px 12px; border-bottom: 1px solid #232323; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: #8a8a8a; }
  figure.before figcaption { color: #e0917f; background: #1f1513; }
  figure.after figcaption { color: #8fd76f; background: #131c12; }
  iframe { display: block; width: 100%; height: 400px; border: 0; background: transparent; }
`

interface LegacyPages {
  success: string
  error: (message: string) => string
}

// ---------------------------------------------------------------------------
// Faithful snapshots of the old pages (reference only — not used at runtime).
// Scripts are omitted; these are visual snapshots.
// ---------------------------------------------------------------------------

function legacyMcp(): LegacyPages {
  const shell = (head: string, body: string) => `<!DOCTYPE html>
<html>
<head>
  <title>OpenCode - Authorization ${head}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #eee; }
    .container { text-align: center; padding: 2rem; }
    h1 { color: ${head === "Successful" ? "#4ade80" : "#f87171"}; margin-bottom: 1rem; }
    p { color: #aaa; }
    .error { color: #fca5a5; font-family: monospace; margin-top: 1rem; padding: 1rem; background: rgba(248,113,113,0.1); border-radius: 0.5rem; }
  </style>
</head>
<body>
  <div class="container">${body}</div>
</body>
</html>`
  return {
    success: shell(
      "Successful",
      `\n    <h1>Authorization Successful</h1>\n    <p>You can close this window and return to OpenCode.</p>\n  `,
    ),
    error: (message) =>
      shell(
        "Failed",
        `\n    <h1>Authorization Failed</h1>\n    <p>An error occurred during authorization.</p>\n    <div class="error">${message}</div>\n  `,
      ),
  }
}

function legacyOpenai(): LegacyPages {
  return {
    success: `<!doctype html><title>OpenCode</title><h1>Authorization successful</h1><p>You can close this window.</p>`,
    error: (message) => `<!doctype html><title>OpenCode</title><h1>Authorization failed</h1><p>${message}</p>`,
  }
}

function legacyEmber(prefix: string): LegacyPages {
  const shell = (state: "Successful" | "Failed", body: string) => `<!doctype html>
<html>
  <head>
    <title>OpenCode - ${prefix} Authorization ${state}</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #131010; color: #f1ecec; }
      .container { text-align: center; padding: 2rem; }
      h1 { color: ${state === "Successful" ? "#f1ecec" : "#fc533a"}; margin-bottom: 1rem; }
      p { color: #b7b1b1; }
      .error { color: #ff917b; font-family: monospace; margin-top: 1rem; padding: 1rem; background: #3c140d; border-radius: 0.5rem; }
    </style>
  </head>
  <body>
    <div class="container">${body}</div>
  </body>
</html>`
  return {
    success: shell(
      "Successful",
      `\n      <h1>Authorization Successful</h1>\n      <p>You can close this window and return to OpenCode.</p>\n    `,
    ),
    error: (message) =>
      shell(
        "Failed",
        `\n      <h1>Authorization Failed</h1>\n      <p>An error occurred during authorization.</p>\n      <div class="error">${message}</div>\n    `,
      ),
  }
}

function legacySnowflake(): LegacyPages {
  return {
    success: `<!doctype html>
<html>
  <head><title>OpenCode - Snowflake Authorization Successful</title></head>
  <body style="font-family: system-ui; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; background:#111; color:#eee;">
    <div style="text-align:center; max-width:36rem; padding:2rem;">
      <h1 style="color:#7ee787;">Authorization Successful</h1>
      <p>You can close this window and return to OpenCode.</p>
    </div>
  </body>
</html>`,
    error: (message) => `<!doctype html>
<html>
  <head><title>OpenCode - Snowflake Authorization Failed</title></head>
  <body style="font-family: system-ui; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; background:#111; color:#eee;">
    <div style="text-align:center; max-width:48rem; padding:2rem;">
      <h1 style="color:#ff7b72;">Authorization Failed</h1>
      <pre style="white-space:pre-wrap; color:#ffb3ad; background:#2a1210; padding:1rem; border-radius:.5rem;">${message}</pre>
    </div>
  </body>
</html>`,
  }
}

function legacyDigitalOcean(): LegacyPages {
  const shell = (title: string, inner: string) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>OpenCode - DigitalOcean Authorization</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0b1220; color: #e8eef9; }
      .container { text-align: center; padding: 2rem; max-width: 32rem; }
      h1 { color: #e8eef9; margin-bottom: 1rem; }
      p { color: #9aa9c0; }
      .error { color: #ff917b; font-family: monospace; margin-top: 1rem; padding: 1rem; background: #3c140d; border-radius: 0.5rem; }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>${title}</h1>${inner}
    </div>
  </body>
</html>`
  return {
    success: shell("Authorization Successful", `\n      <p>You can close this window and return to OpenCode.</p>`),
    error: (message) => shell("Authorization Failed", `\n      <div class="error">${message}</div>`),
  }
}
