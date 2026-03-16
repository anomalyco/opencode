/**
 * Checks if any HTTP proxy environment variables are configured.
 *
 * This utility detects whether the application should use a proxy by
 * checking for common proxy environment variables (HTTP_PROXY, HTTPS_PROXY,
 * http_proxy, https_proxy). Used to conditionally configure HTTP clients
 * for proxy support.
 *
 * @returns true if any proxy environment variable is set, false otherwise
 */
export function proxied() {
  return !!(process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.https_proxy)
}
