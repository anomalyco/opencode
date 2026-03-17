/**
 * Checks if HTTP proxy environment variables are set.
 *
 * Detects proxy configuration from standard environment variables:
 * HTTP_PROXY, HTTPS_PROXY, http_proxy, https_proxy
 *
 * @returns True if any proxy environment variable is set
 *
 * @example
 * ```typescript
 * if (proxied()) {
 *   console.log("Using HTTP proxy")
 * }
 * ```
 */
export function proxied() {
  return !!(process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.https_proxy)
}
