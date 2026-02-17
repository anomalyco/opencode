export type AppManifestResult = {
  id: number
  slug: string
  pem: string
  webhook_secret: string
  client_id: string
  client_secret: string
}

export interface AppConfig {
  ghesHost: string
  appId: string
  appPrivateKey: string
}

let storedConfig: AppConfig | null = null

export function getStoredConfig(): AppConfig | null {
  return storedConfig
}

export function setStoredConfig(config: AppConfig) {
  storedConfig = config
}

export async function exchangeManifestCode(ghesHost: string, code: string): Promise<AppManifestResult> {
  const response = await fetch(`https://${ghesHost}/api/v3/app-manifests/${code}/conversions`, {
    method: "POST",
    headers: { Accept: "application/vnd.github+json" },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Failed to create app: ${response.status} ${body}`)
  }

  return (await response.json()) as AppManifestResult
}

export function buildManifest(routeHost: string) {
  return {
    name: "ghes-exchange",
    url: `https://${routeHost}`,
    hook_attributes: { url: "https://example.com/placeholder" },
    redirect_url: `https://${routeHost}/setup/callback`,
    public: false,
    default_permissions: {
      contents: "write",
      pull_requests: "write",
      issues: "write",
      metadata: "read",
    },
    default_events: ["issue_comment", "pull_request_review_comment"],
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

const STYLE = `
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #1a1a2e; color: #eee; }
    .container { text-align: center; padding: 2rem; max-width: 700px; }
    h1 { color: #60a5fa; margin-bottom: 1rem; }
    p { color: #aaa; }
    .btn { display: inline-block; padding: 0.75rem 1.5rem; background: #3b82f6; color: #fff; border: none; border-radius: 0.5rem; font-size: 1rem; cursor: pointer; text-decoration: none; }
    .btn:hover { background: #2563eb; }
    .status { margin-top: 1.5rem; padding: 1rem; background: rgba(74,222,128,0.1); border-radius: 0.5rem; text-align: left; }
    .status dt { color: #4ade80; font-weight: bold; margin-top: 0.5rem; }
    .status dd { color: #ccc; margin-left: 1rem; font-family: monospace; }
    .error { color: #fca5a5; font-family: monospace; margin-top: 1rem; padding: 1rem; background: rgba(248,113,113,0.1); border-radius: 0.5rem; }
    textarea { width: 100%; height: 120px; background: #0f0f23; color: #ccc; border: 1px solid #333; border-radius: 0.5rem; padding: 0.5rem; font-family: monospace; font-size: 0.8rem; resize: vertical; }
    code { background: #0f0f23; padding: 0.2rem 0.4rem; border-radius: 0.25rem; font-size: 0.85rem; }
    pre { background: #0f0f23; padding: 1rem; border-radius: 0.5rem; text-align: left; overflow-x: auto; font-size: 0.85rem; }
    a { color: #60a5fa; }
`

export function renderLandingPage(ghesHost: string, routeHost: string, configured: boolean, appId?: string): string {
  if (configured) {
    return `<!DOCTYPE html>
<html>
<head>
  <title>GHES Exchange - Configured</title>
  <style>${STYLE}</style>
</head>
<body>
  <div class="container">
    <h1>GHES Exchange Server</h1>
    <p>The exchange server is configured and ready.</p>
    <dl class="status">
      <dt>GHES Host</dt>
      <dd>${escapeHtml(ghesHost)}</dd>
      <dt>App ID</dt>
      <dd>${escapeHtml(appId || "N/A")}</dd>
      <dt>Status</dt>
      <dd style="color: #4ade80;">Operational</dd>
    </dl>
    <p style="margin-top: 1.5rem;">
      <code>POST /exchange_github_app_token</code> with an OIDC Bearer token to get an installation token.
    </p>
  </div>
</body>
</html>`
  }

  const manifest = buildManifest(routeHost)
  const manifestJson = JSON.stringify(manifest)

  return `<!DOCTYPE html>
<html>
<head>
  <title>GHES Exchange - Setup</title>
  <style>${STYLE}</style>
</head>
<body>
  <div class="container">
    <h1>GHES Exchange Server</h1>
    <p>No GitHub App is configured yet. Click the button below to create one on your GHES instance.</p>
    <p style="margin-top: 1rem;">This will redirect you to <strong>${escapeHtml(ghesHost)}</strong> to authorize the app creation.</p>
    <form method="post" action="https://${escapeHtml(ghesHost)}/settings/apps/new" style="margin-top: 1.5rem;">
      <input type="hidden" name="manifest" value='${manifestJson.replace(/'/g, "&#39;")}' />
      <button type="submit" class="btn">Create GitHub App</button>
    </form>
    <p style="margin-top: 2rem; font-size: 0.85rem; color: #666;">
      After creation, you will be redirected back here with the app credentials.
    </p>
  </div>
</body>
</html>`
}

export function renderSuccessPage(result: AppManifestResult, ghesHost: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>GHES Exchange - App Created</title>
  <style>${STYLE}</style>
</head>
<body>
  <div class="container">
    <h1 style="color: #4ade80;">GitHub App Created Successfully</h1>
    <p>The app has been created and the exchange server is now configured in-memory.</p>
    <dl class="status">
      <dt>App ID</dt>
      <dd>${result.id}</dd>
      <dt>Slug</dt>
      <dd>${escapeHtml(result.slug)}</dd>
      <dt>Client ID</dt>
      <dd>${escapeHtml(result.client_id)}</dd>
      <dt>Client Secret</dt>
      <dd>${escapeHtml(result.client_secret)}</dd>
      <dt>Webhook Secret</dt>
      <dd>${escapeHtml(result.webhook_secret)}</dd>
    </dl>

    <h2 style="color: #60a5fa; margin-top: 2rem; font-size: 1.1rem;">Private Key (PEM)</h2>
    <textarea readonly onclick="this.select()">${escapeHtml(result.pem)}</textarea>

    <h2 style="color: #60a5fa; margin-top: 2rem; font-size: 1.1rem;">Persist to Kubernetes (optional)</h2>
    <p style="font-size: 0.85rem;">To survive pod restarts, store the credentials as K8s resources:</p>
    <pre>
# Update ConfigMap with the App ID
oc patch configmap ghes-exchange-config -n arc-runners \\
  --type merge -p '{"data":{"GHES_APP_ID":"${result.id}"}}'

# Create or update the secret with the private key
oc create secret generic opencode-ghes-secrets -n arc-runners \\
  --from-literal=github-app-private-key="$(cat &lt;pem-file&gt;)" \\
  --dry-run=client -o yaml | oc apply -f -

# Restart the deployment to pick up changes
oc rollout restart deployment/ghes-exchange -n arc-runners</pre>

    <p style="margin-top: 1.5rem;">
      <strong>Important:</strong> Save the private key now. It cannot be retrieved from GitHub again.
    </p>
    <p style="margin-top: 1rem;">
      <a href="https://${escapeHtml(ghesHost)}/settings/apps/${escapeHtml(result.slug)}">View app on GHES</a>
      &nbsp;|&nbsp;
      <a href="/">Back to status page</a>
    </p>
  </div>
</body>
</html>`
}

export function renderErrorPage(error: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>GHES Exchange - Error</title>
  <style>${STYLE}</style>
</head>
<body>
  <div class="container">
    <h1 style="color: #f87171;">Setup Error</h1>
    <p>An error occurred during GitHub App creation.</p>
    <div class="error">${escapeHtml(error)}</div>
    <p style="margin-top: 1.5rem;"><a href="/">Back to setup page</a></p>
  </div>
</body>
</html>`
}
