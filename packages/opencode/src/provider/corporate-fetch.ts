/**
 * Corporate-friendly fetch implementation
 * Supports:
 * - Auto-detection of proxy settings
 * - Interactive proxy authentication
 * - Custom CA certificates (bundles supported)
 * - Client certificates
 */

import { readFileSync } from "fs"
import { ProxyAgent } from "undici"
import { fetch as undiciFetch } from "undici"
import { detectProxySettings, type ProxyConfig } from "./proxy-detection"
import { createProxyAuthFetch } from "./proxy-auth"

export interface TLSConfig {
	/**
	 * Path to CA certificate file (can contain multiple certificates in a bundle)
	 * OR array of paths to multiple CA certificate files
	 */
	ca?: string | string[]

	/**
	 * Path to client certificate (for mutual TLS)
	 */
	cert?: string

	/**
	 * Path to client private key
	 */
	key?: string

	/**
	 * If true, validate server certificate against CAs (default: true)
	 * Set to false only for testing with self-signed certificates
	 */
	rejectUnauthorized?: boolean
}

export interface CorporateFetchOptions {
	/**
	 * Proxy configuration
	 * If not provided, will auto-detect from environment/system settings
	 */
	proxy?: ProxyConfig | "auto" | false

	/**
	 * TLS/Certificate configuration
	 */
	tls?: TLSConfig

	/**
	 * Request timeout in milliseconds
	 * Set to false to disable timeout
	 */
	timeout?: number | false

	/**
	 * Enable interactive prompts for proxy authentication
	 * Default: true in CLI, false in programmatic usage
	 */
	interactive?: boolean

	/**
	 * Target URL for proxy auto-detection
	 * Only needed if proxy: "auto"
	 */
	targetUrl?: string
}

/**
 * Create a corporate-friendly fetch function
 *
 * @example
 * ```typescript
 * // Auto-detect proxy, use custom CA bundle
 * const corporateFetch = await createCorporateFetch({
 *   proxy: "auto",
 *   tls: {
 *     ca: "/etc/ssl/certs/corporate-ca-bundle.crt"
 *   },
 *   targetUrl: "https://api.internal.company.com"
 * })
 *
 * const response = await corporateFetch("https://api.internal.company.com/v1/models")
 * ```
 *
 * @example
 * ```typescript
 * // Manual proxy configuration with client certificate
 * const corporateFetch = await createCorporateFetch({
 *   proxy: {
 *     url: "http://proxy.company.com:8080",
 *     username: "user",
 *     password: "pass"
 *   },
 *   tls: {
 *     ca: "/etc/ssl/certs/corporate-ca.crt",
 *     cert: "/etc/ssl/certs/client-cert.pem",
 *     key: "/etc/ssl/private/client-key.pem"
 *   }
 * })
 * ```
 *
 * @example
 * ```typescript
 * // Multiple CA certificates
 * const corporateFetch = await createCorporateFetch({
 *   tls: {
 *     ca: [
 *       "/etc/ssl/certs/root-ca.crt",
 *       "/etc/ssl/certs/intermediate-ca.crt",
 *       "/etc/ssl/certs/company-ca.crt"
 *     ]
 *   }
 * })
 * ```
 */
export async function createCorporateFetch(
	options: CorporateFetchOptions = {}
): Promise<typeof fetch> {
	const {
		proxy = "auto",
		tls,
		timeout,
		interactive = true,
		targetUrl = "https://api.openai.com",
	} = options

	// 1. Resolve proxy configuration
	let resolvedProxy: ProxyConfig | null = null

	if (proxy === "auto") {
		// Auto-detect proxy settings
		resolvedProxy = await detectProxySettings(targetUrl, interactive)
	} else if (proxy && proxy !== false) {
		// Use provided proxy configuration
		resolvedProxy = proxy
	}

	// 2. Load TLS certificates
	const tlsOptions: any = {}

	if (tls) {
		if (tls.ca) {
			if (Array.isArray(tls.ca)) {
				// Multiple CA certificate files
				tlsOptions.ca = tls.ca.map((path) => {
					console.log(`📜 Loading CA certificate: ${path}`)
					return readFileSync(path, "utf-8")
				})
			} else {
				// Single CA certificate file (may contain multiple certs in bundle)
				console.log(`📜 Loading CA certificate bundle: ${tls.ca}`)
				tlsOptions.ca = readFileSync(tls.ca, "utf-8")

				// Count certificates in bundle for user feedback
				const certCount = (tlsOptions.ca.match(/BEGIN CERTIFICATE/g) || []).length
				if (certCount > 1) {
					console.log(`   Found ${certCount} certificates in bundle`)
				}
			}
		}

		if (tls.cert) {
			console.log(`📜 Loading client certificate: ${tls.cert}`)
			tlsOptions.cert = readFileSync(tls.cert, "utf-8")
		}

		if (tls.key) {
			console.log(`🔑 Loading client private key: ${tls.key}`)
			tlsOptions.key = readFileSync(tls.key, "utf-8")
		}

		if (tls.rejectUnauthorized !== undefined) {
			tlsOptions.rejectUnauthorized = tls.rejectUnauthorized
			if (!tls.rejectUnauthorized) {
				console.warn(
					"⚠️  Certificate validation disabled (rejectUnauthorized: false). Use only for testing!"
				)
			}
		}
	}

	// 3. Create proxy agent if proxy is configured
	let dispatcher: ProxyAgent | undefined

	if (resolvedProxy) {
		const proxyUrl = new URL(resolvedProxy.url)

		// Add authentication to proxy URL if provided
		if (resolvedProxy.username) {
			proxyUrl.username = resolvedProxy.username
		}
		if (resolvedProxy.password) {
			proxyUrl.password = resolvedProxy.password
		}

		console.log(`🌐 Using proxy: ${maskProxyUrl(proxyUrl.toString())}`)

		dispatcher = new ProxyAgent({
			uri: proxyUrl.toString(),
			...tlsOptions, // Apply TLS settings to proxy agent
		})
	}

	// 4. Create base fetch function
	const baseFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const fetchOptions: any = { ...init }

		// Apply proxy agent
		if (dispatcher) {
			fetchOptions.dispatcher = dispatcher
		}

		// Apply TLS options directly if no proxy
		if (!dispatcher && Object.keys(tlsOptions).length > 0) {
			Object.assign(fetchOptions, tlsOptions)
		}

		// Apply timeout
		if (timeout !== undefined && timeout !== false) {
			const signals: AbortSignal[] = []

			// Preserve existing abort signal
			if (fetchOptions.signal) {
				signals.push(fetchOptions.signal)
			}

			// Add timeout signal
			signals.push(AbortSignal.timeout(timeout))

			// Combine signals
			fetchOptions.signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0]
		}

		// Use undici's fetch for full Node.js compatibility
		return undiciFetch(input, fetchOptions)
	}

	// 5. Wrap with proxy authentication handler if interactive
	if (resolvedProxy && interactive) {
		return createProxyAuthFetch(baseFetch, resolvedProxy)
	}

	return baseFetch
}

/**
 * Mask credentials in proxy URL for safe display
 */
function maskProxyUrl(url: string): string {
	try {
		const parsed = new URL(url)
		if (parsed.username || parsed.password) {
			return `${parsed.protocol}//${parsed.username ? "***:***@" : ""}${parsed.host}`
		}
		return url
	} catch {
		return url
	}
}

/**
 * Helper: Create corporate fetch from environment variables only
 * Uses standard env vars: HTTP_PROXY, HTTPS_PROXY, NODE_EXTRA_CA_CERTS
 */
export async function createCorporateFetchFromEnv(
	targetUrl: string
): Promise<typeof fetch> {
	return createCorporateFetch({
		proxy: "auto",
		tls: process.env.NODE_EXTRA_CA_CERTS
			? {
					ca: process.env.NODE_EXTRA_CA_CERTS,
				}
			: undefined,
		targetUrl,
		interactive: false, // Don't prompt when using env vars
	})
}
