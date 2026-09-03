type Artifact = {
  channel: string
  name: string
  distribution: string
  version: string
  metadata: Record<string, unknown>
}

type DesktopFile = {
  url: string
  sha512: string
  size: number
  blockMapSize?: number
}

export namespace UpdateArtifact {
  export async function publish(artifact: Artifact) {
    if (process.env.GITHUB_ACTIONS !== "true") {
      console.log("skipped update artifact publication outside GitHub Actions")
      return
    }
    const requestURL = process.env.ACTIONS_ID_TOKEN_REQUEST_URL
    const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
    if (!requestURL || !requestToken) throw new Error("GitHub Actions OIDC is unavailable")

    const url = new URL(requestURL)
    url.searchParams.set("audience", "https://update.opencode.ai")
    const tokenResponse = await fetch(url, { headers: { Authorization: `Bearer ${requestToken}` } })
    if (!tokenResponse.ok) throw new Error(`Failed to request GitHub OIDC token: ${tokenResponse.status}`)
    const token: unknown = await tokenResponse.json()
    if (!isRecord(token) || typeof token.value !== "string")
      throw new Error("GitHub OIDC response did not include a token")

    for (const attempt of [0, 1, 2]) {
      const response = await fetch("https://update.opencode.ai/api/publish", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.value}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(artifact),
      })
      if (response.ok) return
      // D1 can commit the upsert and still time out. Replaying the same artifact is safe.
      if (response.status >= 500 && attempt < 2) {
        await response.arrayBuffer()
        console.warn(`Update artifact publication returned ${response.status}; retrying`)
        await Bun.sleep((attempt + 1) * 1_000)
        continue
      }
      throw new Error(`Failed to publish update artifact: ${response.status} ${await response.text()}`)
    }
  }

  export async function desktopMetadata(version: string, repo: string) {
    const directory = process.env.RUNNER_TEMP ?? "/tmp"
    const entries = await Promise.all(
      [
        ["desktop.yml", "latest.yml"],
        ["desktop-mac.yml", "latest-mac.yml"],
        ["desktop-linux.yml", "latest-linux.yml"],
        ["desktop-linux-arm64.yml", "latest-linux-arm64.yml"],
      ].map(async ([name, source]) => {
        const file = Bun.file(`${directory}/${source}`)
        if (!(await file.exists())) return
        return [name, parseDesktop(await file.text(), version, repo)] as const
      }),
    )
    const manifests = Object.fromEntries(entries.filter((entry) => entry !== undefined))
    if (!Object.keys(manifests).length) throw new Error("No desktop update metadata found")
    return { manifests }
  }
}

function parseDesktop(content: string, version: string, repo: string) {
  const lines = content.split("\n")
  const found = lines
    .find((line) => line.startsWith("version:"))
    ?.slice("version:".length)
    .trim()
  if (found !== version) throw new Error(`Desktop metadata version mismatch: expected ${version}, got ${found}`)
  const releaseDate = lines
    .find((line) => line.startsWith("releaseDate:"))
    ?.slice("releaseDate:".length)
    .trim()
    .replace(/^['"]|['"]$/g, "")
  if (!releaseDate) throw new Error("Desktop metadata did not include a release date")

  const files: DesktopFile[] = []
  lines.forEach((line) => {
    const value = line.trim()
    if (value.startsWith("- url:")) {
      const name = value.slice("- url:".length).trim()
      files.push({
        url: name.startsWith("http")
          ? name
          : `https://github.com/${repo}/releases/download/v${version}/${encodeURIComponent(name)}`,
        sha512: "",
        size: 0,
      })
      return
    }
    const current = files.at(-1)
    if (!current) return
    if (value.startsWith("sha512:")) current.sha512 = value.slice("sha512:".length).trim()
    if (value.startsWith("size:")) current.size = Number(value.slice("size:".length).trim())
    if (value.startsWith("blockMapSize:")) current.blockMapSize = Number(value.slice("blockMapSize:".length).trim())
  })
  if (!files.length || files.some((file) => !file.sha512 || !file.size)) {
    throw new Error("Desktop metadata contained an incomplete file")
  }
  return { files, releaseDate }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}
