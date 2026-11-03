const publicFaviconHost = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

const privateFaviconSuffix = /\.(?:alt|example|internal|invalid|local|localhost|onion|test|ts\.net)$/

/** The icon service's favicon for a public web host; undefined for a private one, whose name stays on this device. */
export function faviconURL(url: URL) {
  const host = url.hostname.toLowerCase()

  if (!publicFaviconHost.test(host) || privateFaviconSuffix.test(host)) return undefined

  if (host === "home.arpa" || host.endsWith(".home.arpa")) return undefined

  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.host)}&sz=32`
}
