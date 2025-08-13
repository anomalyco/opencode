/**
 * This oauth flow is based on https://github.com/openai/codex/blob/c991c6ef8559adce5314907b8bfd41ceb7bb3962/codex-rs/login/src/login_with_chatgpt.py
**/
import { generatePKCE } from "@openauthjs/openauth/pkce"
import { Auth } from "./index"

export namespace AuthOpenAI {
  const ISSUER = "https://auth.openai.com"
  const TOKEN_ENDPOINT = `${ISSUER}/oauth/token`
  const PORT = 1455
  const HOST = "127.0.0.1"
  const REDIRECT = `http://localhost:${PORT}/auth/callback`
  const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann" // Public Client ID for the Codex CLI

  type TokenPayload = {
    id_token: string
    access_token: string
    refresh_token: string
    expires_in?: number
  }

  function randomId(bytes = 12) {
    const buf = new Uint8Array(bytes)
    crypto.getRandomValues(buf)
    return Array.from(buf)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  }

  function decodeSegment(seg: string): any {
    try {
      const padded = seg + "=".repeat((4 - (seg.length % 4)) % 4)
      const dec = atob(padded.replace(/-/g, "+").replace(/_/g, "/"))
      return JSON.parse(dec)
    } catch {
      return {}
    }
  }

  export async function prepare() {
    const pkce = await generatePKCE()
    const state = randomId(32)

    type Status = "success" | "needs_setup" | "failed"
    let resolveDone: (v: Status) => void = () => {}
    const done = new Promise<Status>((resolve) => {
      resolveDone = resolve
    })

    const server = Bun.serve({
      hostname: HOST,
      port: PORT,
      async fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === "/success") {
          const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Sign in</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; }
      .wrap { min-height: 100vh; display: grid; place-items: center; background: #fff; }
      .card { width: min(640px, 92vw); box-shadow: 0 4px 16px rgba(0,0,0,.06); border-radius: 16px; border: 1px solid rgba(13,13,13,.1); padding: 24px; }
      h2 { margin: 0 0 8px 0; font-weight: 600; }
      p { margin: 8px 0; color: #444; }
      .btn { display: inline-block; margin-top: 12px; background: #0d0d0d; color: #fff; border-radius: 999px; padding: 8px 14px; text-decoration: none; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h2>Signed in to opencode</h2>
        <p class="msg">You may now close this tab.</p>
        <a class="btn" style="display:none" href="#" target="_blank" rel="noreferrer noopener">Continue</a>
      </div>
    </div>
    <script>
      (function(){
        var params = new URLSearchParams(window.location.search);
        var needs = params.get('needs_setup') === 'true';
        if (!needs) return;
        var platformUrl = params.get('platform_url') || 'https://platform.openai.com';
        var org = params.get('org_id') || '';
        var proj = params.get('project_id') || '';
        var plan = params.get('plan_type') || '';
        var idt = params.get('id_token') || '';
        var u = new URL('/org-setup', platformUrl);
        if (plan) u.searchParams.set('p', plan);
        if (idt) u.searchParams.set('t', idt);
        if (org) u.searchParams.set('with_org', org);
        if (proj) u.searchParams.set('project_id', proj);
        var btn = document.querySelector('.btn');
        var msg = document.querySelector('.msg');
        btn.href = u.toString();
        btn.style.display = 'inline-block';
        var countdown = 3;
        function tick(){
          msg.textContent = 'Finish setting up your API organization. Redirecting in ' + countdown + 's…';
          if (countdown === 0) { window.location.replace(u.toString()); return; }
          countdown -= 1; setTimeout(tick, 1000);
        }
        tick();
      })();
    </script>
  </body>
  </html>`
          return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } })
        }

        if (url.pathname !== "/auth/callback") return new Response("Not found", { status: 404 })

        if (url.searchParams.get("state") !== state) {
          resolveDone("failed")
          queueMicrotask(() => server.stop())
          return new Response("State mismatch", { status: 400 })
        }

        const code = url.searchParams.get("code")
        if (!code) {
          resolveDone("failed")
          queueMicrotask(() => server.stop())
          return new Response("Missing code", { status: 400 })
        }

        const tokenRes = await fetch(TOKEN_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: REDIRECT,
            client_id: CLIENT_ID,
            code_verifier: pkce.verifier,
          }),
        })

        if (!tokenRes.ok) {
          resolveDone("failed")
          queueMicrotask(() => server.stop())
          return new Response("Token exchange failed", { status: 500 })
        }

        const tokenJson = (await tokenRes.json()) as TokenPayload

        // Inspect ID token claims for organization/project
        let orgId: string | undefined
        let projectId: string | undefined
        let planType: string | undefined
        try {
          const parts = tokenJson.id_token.split(".")
          if (parts.length === 3) {
            const idPayload = decodeSegment(parts[1])
            const auth = (idPayload?.["https://api.openai.com/auth"]) || {}
            orgId = auth.organization_id
            projectId = auth.project_id
          }
        } catch {}

        try {
          const parts = tokenJson.access_token.split(".")
          if (parts.length === 3) {
            const accessPayload = decodeSegment(parts[1])
            const auth = (accessPayload?.["https://api.openai.com/auth"]) || {}
            planType = auth.chatgpt_plan_type
          }
        } catch {}

        // If missing organization/project, do not attempt API-key exchange
        if (!orgId || !projectId) {
          resolveDone("needs_setup")
          const qp = new URLSearchParams({
            needs_setup: "true",
            platform_url: "https://platform.openai.com",
            org_id: orgId || "",
            project_id: projectId || "",
            plan_type: planType || "",
            id_token: tokenJson.id_token,
          })
          queueMicrotask(() => server.stop())
          return new Response(null, { status: 302, headers: { Location: `http://localhost:${PORT}/success?${qp}` } })
        }

        const today = new Date()
          .toISOString()
          .slice(0, 10)
        const name = `opencode (${today}) [${randomId(6)}]`

        const exchangeRes = await fetch(TOKEN_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
            client_id: CLIENT_ID,
            requested_token: "openai-api-key",
            subject_token: tokenJson.id_token,
            subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
            name,
          }),
        })

        if (!exchangeRes.ok) {
          resolveDone("failed")
          queueMicrotask(() => server.stop())
          return new Response("API key exchange failed", { status: 500 })
        }

        const exchangeJson = (await exchangeRes.json()) as { access_token?: string }
        const key = exchangeJson.access_token
        if (!key) {
          resolveDone("failed")
          queueMicrotask(() => server.stop())
          return new Response("No API key returned", { status: 500 })
        }

        await Auth.set("openai", { type: "api", key })

        resolveDone("success")
        queueMicrotask(() => server.stop())
        return new Response(null, {
          status: 302,
          headers: { Location: `http://localhost:${PORT}/success` },
        })
      },
    })

    const url = new URL(`${ISSUER}/oauth/authorize`)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("client_id", CLIENT_ID)
    url.searchParams.set("redirect_uri", REDIRECT)
    url.searchParams.set("scope", "openid profile email offline_access")
    url.searchParams.set("code_challenge", pkce.challenge)
    url.searchParams.set("code_challenge_method", "S256")
    url.searchParams.set("id_token_add_organizations", "true")
    url.searchParams.set("codex_cli_simplified_flow", "true")
    url.searchParams.set("state", state)

    return { url: url.toString(), done }
  }
}


