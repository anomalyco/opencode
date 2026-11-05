// Signs in as the OpenCode GitHub App (GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY, the secrets the
// Api Worker already links) and turns it into an installation access token for the repo: 5,000+
// API calls an hour without a personal token. Web Crypto only, so it runs in the Worker.

/** A JWT for the app, valid for 9 minutes (GitHub allows 10), back-dated a minute for clock drift. */
export async function githubAppJwt(appId: string, privateKey: string, now = Date.now()) {
  const seconds = Math.floor(now / 1000)
  const encode = (value: object) => base64url(new TextEncoder().encode(JSON.stringify(value)))
  const body = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: seconds - 60, exp: seconds + 540, iss: appId })}`
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(body))
  return `${body}.${base64url(new Uint8Array(signature))}`
}

/**
 * An installation access token for `repo` ("owner/name"), with when it expires (GitHub gives an
 * hour), or undefined when GitHub refuses or doesn't answer.
 */
export async function githubAppToken(appId: string, privateKey: string, repo: string) {
  const jwt = await githubAppJwt(appId, privateKey)
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "OpenCode-Console",
    Authorization: `Bearer ${jwt}`,
  }
  const call = (url: string, method = "GET") =>
    fetch(url, { method, headers, signal: AbortSignal.timeout(5000) })
      .then((response) => (response.ok ? response.json() : undefined))
      .catch(() => undefined) as Promise<Record<string, unknown> | undefined>
  const installation = await call(`https://api.github.com/repos/${repo}/installation`)
  if (typeof installation?.id !== "number") return
  const access = await call(`https://api.github.com/app/installations/${installation.id}/access_tokens`, "POST")
  if (typeof access?.token !== "string" || typeof access.expires_at !== "string") return
  return { token: access.token, expires: Date.parse(access.expires_at) }
}

// GitHub hands out PKCS#1 keys ("BEGIN RSA PRIVATE KEY"); Web Crypto imports only PKCS#8, so a
// PKCS#1 key is wrapped in the PKCS#8 structure (version 0, rsaEncryption, the key as an octet string).
function pkcs8(pem: string) {
  const der = Uint8Array.from(
    atob(
      pem
        .replace(/\\n/g, "\n")
        .replace(/-----[^-]+-----/g, "")
        .replace(/\s/g, ""),
    ),
    (char) => char.charCodeAt(0),
  )
  if (!pem.includes("BEGIN RSA PRIVATE KEY")) return der
  const rsaEncryption = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]
  const body = [0x02, 0x01, 0x00, ...rsaEncryption, 0x04, ...length(der.length), ...der]
  return new Uint8Array([0x30, ...length(body.length), ...body])
}

/** A DER length: short form below 128, else the byte count then the big-endian bytes. */
function length(value: number) {
  if (value < 0x80) return [value]
  const bytes = []
  for (let rest = value; rest > 0; rest >>= 8) bytes.unshift(rest & 0xff)
  return [0x80 | bytes.length, ...bytes]
}

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}
