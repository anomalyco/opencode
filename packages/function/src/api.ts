import { Hono } from "hono"
import { jwtVerify, createRemoteJWKSet } from "jose"
import { createAppAuth } from "@octokit/auth-app"
import { Octokit } from "@octokit/rest"
import { Resource } from "sst"
import { parseRepositoryClaim } from "./github"

export default new Hono()
  .get("/", (c) => c.text("Hello, world!"))
  /**
   * Used by the GitHub action to get GitHub installation access token given the OIDC token
   */
  .post("/exchange_github_app_token", async (c) => {
    const EXPECTED_AUDIENCE = "opencode-github-action"
    const GITHUB_ISSUER = "https://token.actions.githubusercontent.com"
    const JWKS_URL = `${GITHUB_ISSUER}/.well-known/jwks`

    // get Authorization header
    const token = c.req.header("Authorization")?.replace(/^Bearer /, "")
    if (!token) return c.json({ error: "Authorization header is required" }, { status: 401 })

    // verify token
    const JWKS = createRemoteJWKSet(new URL(JWKS_URL))
    let repository: ReturnType<typeof parseRepositoryClaim>
    try {
      const { payload } = await jwtVerify(token, JWKS, {
        issuer: GITHUB_ISSUER,
        audience: EXPECTED_AUDIENCE,
      })
      repository = parseRepositoryClaim(payload)
    } catch (err) {
      console.error("Token verification failed:", err)
      return c.json({ error: "Invalid or expired token" }, { status: 403 })
    }

    try {
      const auth = createAppAuth({
        appId: Resource.GITHUB_APP_ID.value,
        privateKey: Resource.GITHUB_APP_PRIVATE_KEY.value,
      })
      const appAuth = await auth({ type: "app" })
      const octokit = new Octokit({ auth: appAuth.token })
      const { data: installation } = await octokit.apps.getRepoInstallation({
        owner: repository.owner,
        repo: repository.repo,
      })
      const installationAuth = await auth({
        type: "installation",
        installationId: installation.id,
        ...(repository.id ? { repositoryIds: [repository.id] } : { repositoryNames: [repository.repo] }),
      })
      return c.json({ token: installationAuth.token })
    } catch (error) {
      console.error("GitHub App token exchange failed:", error)
      return c.json(
        { error: `Failed to exchange GitHub App token for ${repository.owner}/${repository.repo}` },
        { status: 502 },
      )
    }
  })
  .all("*", (c) => c.text("Not Found", 404))
