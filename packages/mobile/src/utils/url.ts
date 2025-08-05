export interface ParsedServerUrl {
  hostname: string
  port: number
  protocol: "http" | "https"
  fullUrl: string
}

export function parseServerUrl(input: string): ParsedServerUrl {
  // Handle cases where user enters just hostname:port or hostname
  let urlString = input.trim()

  // If no protocol, assume http for local/private IPs, https for public domains
  if (!urlString.startsWith("http://") && !urlString.startsWith("https://")) {
    const hostname = urlString.split(":")[0]
    const isLocal =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("172.16.") ||
      hostname.startsWith("172.17.") ||
      hostname.startsWith("172.18.") ||
      hostname.startsWith("172.19.") ||
      hostname.startsWith("172.20.") ||
      hostname.startsWith("172.21.") ||
      hostname.startsWith("172.22.") ||
      hostname.startsWith("172.23.") ||
      hostname.startsWith("172.24.") ||
      hostname.startsWith("172.25.") ||
      hostname.startsWith("172.26.") ||
      hostname.startsWith("172.27.") ||
      hostname.startsWith("172.28.") ||
      hostname.startsWith("172.29.") ||
      hostname.startsWith("172.30.") ||
      hostname.startsWith("172.31.") ||
      /^\d+\.\d+\.\d+\.\d+$/.test(hostname) // Any IP address defaults to http

    urlString = `${isLocal ? "http" : "https"}://${urlString}`
  }

  try {
    const url = new URL(urlString)
    const protocol = url.protocol.slice(0, -1) as "http" | "https"

    let port: number
    if (url.port) {
      port = parseInt(url.port, 10)
    } else {
      // Use default ports
      port = protocol === "https" ? 443 : 80
    }

    return {
      hostname: url.hostname,
      port,
      protocol,
      fullUrl: url.toString().replace(/\/$/, ""), // Remove trailing slash
    }
  } catch (error) {
    throw new Error(`Invalid URL format: ${input}`)
  }
}

export function buildServerUrl(hostname: string, port: number, protocol: "http" | "https" = "http"): string {
  const defaultPort = protocol === "https" ? 443 : 80
  const portSuffix = port === defaultPort ? "" : `:${port}`
  return `${protocol}://${hostname}${portSuffix}`
}
