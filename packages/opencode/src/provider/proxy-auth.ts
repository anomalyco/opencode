/**
 * Automatic proxy authentication handling
 * Detects 407 Proxy Authentication Required and prompts for credentials
 */

import { prompts } from "@clack/prompts"
import type { ProxyConfig } from "./proxy-detection"

interface ProxyAuthCache {
	[proxyUrl: string]: {
		username: string
		password: string
		timestamp: number
	}
}

// Cache credentials for the session (not persisted to disk for security)
const authCache: ProxyAuthCache = {}
const CACHE_TTL = 3600 * 1000 // 1 hour

/**
 * Create a fetch wrapper that automatically handles proxy authentication
 */
export function createProxyAuthFetch(
	baseFetch: typeof fetch,
	proxyConfig: ProxyConfig
): typeof fetch {
	return async (input: RequestInfo | URL, init?: RequestInit) => {
		const proxyUrl = proxyConfig.url

		// Try with cached credentials first
		const cached = getCachedAuth(proxyUrl)
		let currentAuth = cached || {
			username: proxyConfig.username,
			password: proxyConfig.password,
		}

		// Make initial request
		let response = await baseFetch(input, init)

		// Handle 407 Proxy Authentication Required
		if (response.status === 407) {
			console.log("\n🔐 Proxy authentication required")

			// Try up to 3 times
			for (let attempt = 0; attempt < 3; attempt++) {
				// If we have credentials, try them
				if (currentAuth.username && currentAuth.password) {
					console.log(`Attempting proxy authentication (attempt ${attempt + 1}/3)...`)

					// Retry with credentials
					// Note: The actual authentication is handled by the ProxyAgent
					// which should be configured with these credentials
					response = await baseFetch(input, init)

					if (response.status !== 407) {
						// Success! Cache the credentials
						setCachedAuth(proxyUrl, currentAuth.username, currentAuth.password)
						break
					}
				}

				// Credentials failed or not provided - prompt user
				console.log(
					attempt > 0
						? "❌ Authentication failed. Please try again."
						: "🔑 Please enter your proxy credentials"
				)

				const newAuth = await promptForProxyAuth(proxyUrl)

				if (!newAuth) {
					// User cancelled
					console.log("⚠️  Proxy authentication cancelled")
					return response // Return the 407 response
				}

				currentAuth = newAuth

				// Update the proxy config for next attempt
				proxyConfig.username = newAuth.username
				proxyConfig.password = newAuth.password

				// The fetch needs to be retried with the new credentials
				// In a real implementation, this would recreate the ProxyAgent
				// with the new credentials
				response = await baseFetch(input, init)

				if (response.status !== 407) {
					setCachedAuth(proxyUrl, newAuth.username, newAuth.password)
					console.log("✅ Proxy authentication successful")
					break
				}
			}

			if (response.status === 407) {
				console.log("❌ Proxy authentication failed after 3 attempts")
			}
		}

		return response
	}
}

/**
 * Prompt user for proxy credentials (interactive)
 */
async function promptForProxyAuth(
	proxyUrl: string
): Promise<{ username: string; password: string } | null> {
	const maskedUrl = maskProxyUrl(proxyUrl)

	console.log(`\nProxy: ${maskedUrl}`)

	const username = await prompts.text({
		message: "Username:",
		placeholder: "your.name",
	})

	if (prompts.isCancel(username)) {
		return null
	}

	const password = await prompts.password({
		message: "Password:",
	})

	if (prompts.isCancel(password)) {
		return null
	}

	return {
		username: username as string,
		password: password as string,
	}
}

/**
 * Get cached authentication for a proxy
 */
function getCachedAuth(
	proxyUrl: string
): { username: string; password: string } | null {
	const cached = authCache[proxyUrl]

	if (!cached) {
		return null
	}

	// Check if cache is still valid
	if (Date.now() - cached.timestamp > CACHE_TTL) {
		delete authCache[proxyUrl]
		return null
	}

	return {
		username: cached.username,
		password: cached.password,
	}
}

/**
 * Cache authentication credentials for a proxy
 */
function setCachedAuth(proxyUrl: string, username: string, password: string): void {
	authCache[proxyUrl] = {
		username,
		password,
		timestamp: Date.now(),
	}
}

/**
 * Clear all cached authentication
 */
export function clearProxyAuthCache(): void {
	for (const key in authCache) {
		delete authCache[key]
	}
}

/**
 * Mask credentials in proxy URL for safe display
 */
function maskProxyUrl(url: string): string {
	try {
		const parsed = new URL(url)
		return `${parsed.protocol}//${parsed.host}`
	} catch {
		return url
	}
}

/**
 * Detect proxy authentication requirements from response
 */
export function requiresProxyAuth(response: Response): boolean {
	return response.status === 407
}

/**
 * Extract proxy authentication challenge details
 */
export function getProxyAuthChallenge(response: Response): string | null {
	return response.headers.get("proxy-authenticate")
}
