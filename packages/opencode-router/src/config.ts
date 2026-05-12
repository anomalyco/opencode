function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  namespace: process.env.OPENCODE_NAMESPACE ?? "opencode",
  opencodeImage: required("OPENCODE_IMAGE"),
  chromiumImage: process.env.CHROMIUM_IMAGE ?? "chromedp/headless-shell:latest",
  opencodePort: 4096,
  /**
   * Port for the attach server (local client connecting to router session).
   * This server is NOT behind oauth2-proxy and handles attach subdomain requests
   * with password-based auth instead of OAuth.
   * Default: 4096 (different from main port 3000).
   */
  attachPort: Number(process.env.ATTACH_PORT ?? 4096),
  /**
   * Prefix for attach session subdomains.
   * Attach URLs will be: https://<attachRoutePrefix><hash><routeSuffix>.<routerDomain>
   * Default: "attach-"
   */
  attachRoutePrefix: process.env.ATTACH_ROUTE_PREFIX ?? "attach-",
  idleTimeoutMinutes: Number(process.env.IDLE_TIMEOUT_MINUTES ?? 15),
  apiKeySecretName: process.env.API_KEY_SECRET_NAME ?? "opencode-api-keys",
  configMapName: process.env.CONFIG_MAP_NAME ?? "opencode-config-dir",
  imagePullSecretName: process.env.IMAGE_PULL_SECRET_NAME ?? "",
  storageClass: process.env.STORAGE_CLASS ?? "",
  storageSize: process.env.STORAGE_SIZE ?? "2Gi",
  defaultGitRepo: process.env.DEFAULT_GIT_REPO,
  publicDir: process.env.PUBLIC_DIR ?? new URL("../public", import.meta.url).pathname,
  /**
   * The base domain (e.g. "no-panic.org").
   * Sessions are served at https://<hash><routeSuffix>.<routerDomain>.
   * Required — subdomain routing is the only supported session isolation strategy.
   */
  routerDomain: required("ROUTER_DOMAIN"),
  /**
   * Suffix appended to the session hash to form the session subdomain.
   * e.g. ROUTE_SUFFIX="-oc" → session URL: https://<hash>-oc.<routerDomain>
   * Defaults to "" (hash.<routerDomain>) for local dev / backward compatibility.
   * Set to "-oc" in production so sessions stay at the first subdomain level,
   * covered by the *.no-panic.org Universal SSL certificate.
   */
  routeSuffix: process.env.ROUTE_SUFFIX ?? "",
  /**
   * Protocol used when building public session URLs (e.g. "https" in production,
   * "http" for local dev). Defaults to "https".
   * Set ROUTER_PROTO=http when running the router locally without TLS.
   */
  routerProto: process.env.ROUTER_PROTO ?? "https",
  /**
   * The internal URL the opencode-router-plugin uses to push session progress events back
   * to this router from inside the cluster (e.g. "http://opencode-router.opencode-router.svc.cluster.local").
   * When unset, the plugin is not configured and no progress events are pushed.
   * Example: OPENCODE_ROUTER_URL=http://opencode-router.opencode-router.svc.cluster.local
   */
  opencodeRouterUrl: process.env.OPENCODE_ROUTER_URL,
  /**
   * Dev-only: when set, the router proxies the setup UI to this Vite dev server URL
   * instead of serving static files from publicDir. Enables HMR without a redirect loop.
   * Example: DEV_VITE_URL=http://localhost:5173
   */
  devViteUrl: process.env.DEV_VITE_URL,
  /**
   * Dev-only: assumed email when X-Auth-Request-Email header is absent (never set in production)
   */
  devEmail: process.env.DEV_EMAIL,
  /**
   * Dev-only: fixed proxy target (e.g. "http://localhost:4096") used instead of looking up
   * the pod IP. Needed when running the router outside the cluster where pod IPs are unreachable.
   * Set this and port-forward the user pod: kubectl port-forward <pod> 4096:4096 -n opencode-router
   */
  devPodProxyTarget: process.env.DEV_POD_PROXY_TARGET,
  /**
   * When true, log all incoming request headers on every API call.
   * Set DEBUG_HEADERS=true on the deployment to diagnose missing auth headers.
   */
  debugHeaders: process.env.DEBUG_HEADERS === "true",
  /**
   * Secret for admin endpoints (e.g. /api/admin/pull-image).
   * CI systems use X-Admin-Secret header to authenticate.
   * Optional — when unset, admin endpoints are disabled.
   */
  get adminSecret() {
    return process.env.ADMIN_SECRET
  },
}
