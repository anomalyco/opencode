/**
 * Auto-detection of corporate proxy settings
 * Supports environment variables, system settings, and PAC files
 */

import { prompts } from "@clack/prompts"
import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

export interface ProxyConfig {
	url: string
	username?: string
	password?: string
	bypass?: string[] // NO_PROXY domains
}

/**
 * Detect proxy settings from multiple sources
 * Priority order:
 * 1. Environment variables (HTTP_PROXY, HTTPS_PROXY)
 * 2. System proxy settings (OS-specific)
 * 3. PAC file (if detected)
 */
export async function detectProxySettings(
	targetUrl: string,
	interactive = true
): Promise<ProxyConfig | null> {
	// 1. Try environment variables (most common in corporate environments)
	const envProxy = getProxyFromEnv(targetUrl)
	if (envProxy) {
		console.log(`🔍 Detected proxy from environment: ${maskProxyUrl(envProxy.url)}`)
		return envProxy
	}

	// 2. Try system proxy settings
	const systemProxy = await getSystemProxy(targetUrl)
	if (systemProxy) {
		console.log(`🔍 Detected proxy from system settings: ${maskProxyUrl(systemProxy.url)}`)

		if (interactive) {
			const useProxy = await prompts.confirm({
				message: `Use detected proxy ${maskProxyUrl(systemProxy.url)}?`,
				initialValue: true,
			})

			if (!useProxy) {
				return null
			}
		}

		return systemProxy
	}

	// 3. No proxy detected
	if (interactive) {
		const hasProxy = await prompts.confirm({
			message: "No proxy detected. Do you need to use a proxy?",
			initialValue: false,
		})

		if (hasProxy) {
			return await promptForProxyConfig()
		}
	}

	return null
}

/**
 * Read proxy from environment variables
 * Supports: HTTP_PROXY, HTTPS_PROXY, ALL_PROXY, NO_PROXY
 */
function getProxyFromEnv(targetUrl: string): ProxyConfig | null {
	const url = new URL(targetUrl)
	const protocol = url.protocol.replace(":", "")

	// Check protocol-specific proxy first
	const proxyUrl =
		process.env[`${protocol}_proxy`] ||
		process.env[`${protocol.toUpperCase()}_PROXY`] ||
		process.env["all_proxy"] ||
		process.env["ALL_PROXY"]

	if (!proxyUrl) {
		return null
	}

	// Check if target is in NO_PROXY list
	const noProxy = process.env["no_proxy"] || process.env["NO_PROXY"]
	if (noProxy && shouldBypassProxy(url.hostname, noProxy)) {
		return null
	}

	// Parse proxy URL (may contain auth: http://user:pass@proxy:8080)
	const proxy = new URL(proxyUrl)
	const config: ProxyConfig = {
		url: `${proxy.protocol}//${proxy.host}`,
	}

	if (proxy.username) {
		config.username = decodeURIComponent(proxy.username)
	}
	if (proxy.password) {
		config.password = decodeURIComponent(proxy.password)
	}

	if (noProxy) {
		config.bypass = noProxy.split(",").map((s) => s.trim())
	}

	return config
}

/**
 * Get proxy settings from OS-specific system configuration
 */
async function getSystemProxy(targetUrl: string): Promise<ProxyConfig | null> {
	const platform = process.platform

	try {
		if (platform === "win32") {
			return await getWindowsProxy(targetUrl)
		} else if (platform === "darwin") {
			return await getMacOSProxy(targetUrl)
		} else if (platform === "linux") {
			return await getLinuxProxy(targetUrl)
		}
	} catch (error) {
		// Silent fail - system proxy detection is optional
		console.debug("Failed to detect system proxy:", error)
	}

	return null
}

/**
 * Windows: Read from registry (Internet Settings)
 */
async function getWindowsProxy(targetUrl: string): Promise<ProxyConfig | null> {
	try {
		// Read from registry: HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings
		const { stdout } = await execAsync(
			'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable'
		)

		if (!stdout.includes("0x1")) {
			return null // Proxy not enabled
		}

		const { stdout: proxyServer } = await execAsync(
			'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer'
		)

		const match = proxyServer.match(/ProxyServer\s+REG_SZ\s+(.+)/)
		if (match) {
			const proxy = match[1].trim()
			// Format can be "proxy:8080" or "http=proxy:8080;https=proxy2:8080"
			const httpsProxy = proxy.match(/https=([^;]+)/)
			const httpProxy = proxy.match(/http=([^;]+)/)
			const genericProxy = proxy.includes("=") ? null : proxy

			const url = new URL(targetUrl)
			const proxyHost =
				(url.protocol === "https:" ? httpsProxy?.[1] : httpProxy?.[1]) || genericProxy

			if (proxyHost) {
				return {
					url: proxyHost.includes("://") ? proxyHost : `http://${proxyHost}`,
				}
			}
		}
	} catch (error) {
		// Registry read failed
	}

	return null
}

/**
 * macOS: Read from system preferences (scutil)
 */
async function getMacOSProxy(targetUrl: string): Promise<ProxyConfig | null> {
	try {
		const { stdout } = await execAsync("scutil --proxy")

		const url = new URL(targetUrl)
		const isHttps = url.protocol === "https:"

		const proxyHostKey = isHttps ? "HTTPSProxy" : "HTTPProxy"
		const proxyPortKey = isHttps ? "HTTPSPort" : "HTTPPort"
		const proxyEnableKey = isHttps ? "HTTPSEnable" : "HTTPEnable"

		const enabled = stdout.match(new RegExp(`${proxyEnableKey}\\s*:\\s*1`))
		if (!enabled) {
			return null
		}

		const hostMatch = stdout.match(new RegExp(`${proxyHostKey}\\s*:\\s*(.+)`))
		const portMatch = stdout.match(new RegExp(`${proxyPortKey}\\s*:\\s*(\\d+)`))

		if (hostMatch) {
			const host = hostMatch[1].trim()
			const port = portMatch ? portMatch[1].trim() : "8080"

			return {
				url: `http://${host}:${port}`,
			}
		}
	} catch (error) {
		// scutil failed
	}

	return null
}

/**
 * Linux: Try to read from GNOME/KDE settings or environment
 */
async function getLinuxProxy(targetUrl: string): Promise<ProxyConfig | null> {
	// Most Linux systems rely on environment variables
	// GNOME/KDE settings are usually exported to env vars

	// Try gsettings (GNOME)
	try {
		const { stdout } = await execAsync(
			"gsettings get org.gnome.system.proxy mode 2>/dev/null || echo 'none'"
		)

		if (stdout.trim() === "'manual'") {
			const url = new URL(targetUrl)
			const scheme = url.protocol === "https:" ? "https" : "http"

			const { stdout: host } = await execAsync(
				`gsettings get org.gnome.system.proxy.${scheme} host`
			)
			const { stdout: port } = await execAsync(
				`gsettings get org.gnome.system.proxy.${scheme} port`
			)

			const proxyHost = host.trim().replace(/'/g, "")
			const proxyPort = port.trim()

			if (proxyHost && proxyHost !== "") {
				return {
					url: `http://${proxyHost}:${proxyPort}`,
				}
			}
		}
	} catch (error) {
		// gsettings not available or failed
	}

	return null
}

/**
 * Check if hostname should bypass proxy based on NO_PROXY rules
 */
function shouldBypassProxy(hostname: string, noProxy: string): boolean {
	const rules = noProxy.split(",").map((s) => s.trim())

	for (const rule of rules) {
		if (rule === "*") return true
		if (rule === hostname) return true
		if (rule.startsWith(".") && hostname.endsWith(rule)) return true
		if (hostname.endsWith(`.${rule}`)) return true

		// CIDR notation support would go here
	}

	return false
}

/**
 * Interactively prompt user for proxy configuration
 */
async function promptForProxyConfig(): Promise<ProxyConfig | null> {
	const proxyUrl = await prompts.text({
		message: "Enter proxy URL (e.g., http://proxy.company.com:8080):",
		placeholder: "http://proxy.company.com:8080",
		validate: (value) => {
			try {
				new URL(value)
				return undefined
			} catch {
				return "Invalid URL format"
			}
		},
	})

	if (prompts.isCancel(proxyUrl)) {
		return null
	}

	const needsAuth = await prompts.confirm({
		message: "Does the proxy require authentication?",
		initialValue: false,
	})

	if (prompts.isCancel(needsAuth)) {
		return null
	}

	const config: ProxyConfig = {
		url: proxyUrl as string,
	}

	if (needsAuth) {
		const username = await prompts.text({
			message: "Proxy username:",
		})

		if (prompts.isCancel(username)) {
			return null
		}

		const password = await prompts.password({
			message: "Proxy password:",
		})

		if (prompts.isCancel(password)) {
			return null
		}

		config.username = username as string
		config.password = password as string
	}

	return config
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
