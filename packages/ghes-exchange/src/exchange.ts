import { createRemoteJWKSet, jwtVerify } from "jose"
import { createAppAuth } from "@octokit/auth-app"
import { Octokit } from "@octokit/rest"

export interface ExchangeConfig {
  ghesHost: string
  appId: string
  appPrivateKey: string
}

export async function exchangeToken(oidcToken: string, config: ExchangeConfig): Promise<string> {
  const ghesUrl = `https://${config.ghesHost}`
  const issuer = `${ghesUrl}/_services/token`
  const jwksUrl = `${issuer}/.well-known/jwks`
  const audience = "opencode-github-action"

  // Verify OIDC token against GHES JWKS
  const JWKS = createRemoteJWKSet(new URL(jwksUrl))
  let owner: string
  let repo: string

  try {
    const { payload } = await jwtVerify(oidcToken, JWKS, {
      issuer,
      audience,
    })
    // sub format: 'repo:my-org/my-repo:ref:refs/heads/main'
    const sub = payload.sub
    if (!sub) throw new Error("Token missing sub claim")
    const repoPart = sub.split(":")[1]
    if (!repoPart) throw new Error("Token sub claim has unexpected format")
    const parts = repoPart.split("/")
    owner = parts[0]!
    repo = parts[1]!
  } catch (err) {
    console.error("Token verification failed:", err)
    throw new Error("Invalid or expired token")
  }

  // Create app JWT and get installation token
  const auth = createAppAuth({
    appId: config.appId,
    privateKey: config.appPrivateKey,
  })
  const appAuth = await auth({ type: "app" })

  const apiUrl = `${ghesUrl}/api/v3`
  const octokit = new Octokit({ auth: appAuth.token, baseUrl: apiUrl })
  const { data: installation } = await octokit.apps.getRepoInstallation({ owner, repo })

  const installationAuth = await auth({
    type: "installation",
    installationId: installation.id,
  })

  return installationAuth.token
}
