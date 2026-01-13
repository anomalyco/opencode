export interface ServerHealthInfo {
  healthy: true
  version: string
}

export interface ServerDiscoveryConfig {
  baseUrl: string
  timeoutMs?: number
  minVersion?: string
  maxVersion?: string
}

export interface ServerDiscoveryResult {
  success: true
  info: ServerHealthInfo
  url: string
  compatible: boolean
  reason?: string
}

export interface ServerDiscoveryError {
  success: false
  phase: "fetch" | "parse"
  message: string
  details?: string
}

interface ParsedVersion {
  major: number
  minor: number
  patch: number
}

export async function discoverServer(
  config: ServerDiscoveryConfig,
): Promise<ServerDiscoveryResult | ServerDiscoveryError> {
  const url = new URL("/global/health", config.baseUrl).toString()
  const timeout = config.timeoutMs ?? 5000

  const response = await fetch(url, { signal: AbortSignal.timeout(timeout) })
    .then((value) => ({ value } as { value: Response }))
    .catch((error) => ({ error } as { error: unknown }))

  if ("error" in response) {
    return {
      success: false,
      phase: "fetch",
      message: "Failed to reach server",
      details: response.error instanceof Error ? response.error.message : String(response.error),
    }
  }

  if (!response.value.ok) {
    const body = await response.value
      .text()
      .then((value) => ({ value } as { value: string }))
      .catch((error) => ({ error } as { error: unknown }))
    return {
      success: false,
      phase: "fetch",
      message: `Server responded with ${response.value.status}`,
      details: "error" in body ? String(body.error) : body.value,
    }
  }

  const parsed = await response.value
    .json()
    .then((value) => ({ value } as { value: unknown }))
    .catch((error) => ({ error } as { error: unknown }))

  if ("error" in parsed) {
    return {
      success: false,
      phase: "parse",
      message: "Failed to parse server health response",
      details: parsed.error instanceof Error ? parsed.error.message : String(parsed.error),
    }
  }

  const info = parseHealth(parsed.value)

  if (!info) {
    return {
      success: false,
      phase: "parse",
      message: "Invalid server health response",
    }
  }

  const compatibility = checkCompatibility(info.version, config)

  return {
    success: true,
    info,
    url,
    compatible: compatibility.compatible,
    reason: compatibility.reason,
  }
}

function parseHealth(value: unknown): ServerHealthInfo | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const record = value as Record<string, unknown>

  if (record.healthy !== true) {
    return null
  }

  if (typeof record.version !== "string") {
    return null
  }

  return {
    healthy: true,
    version: record.version,
  }
}

function checkCompatibility(version: string, config: ServerDiscoveryConfig): { compatible: boolean; reason?: string } {
  const current = parseVersion(version)

  if (!current) {
    return { compatible: false, reason: `Unsupported version format: ${version}` }
  }

  if (config.minVersion) {
    const min = parseVersion(config.minVersion)
    if (!min) {
      return { compatible: false, reason: `Invalid minimum version: ${config.minVersion}` }
    }
    if (compareVersions(current, min) < 0) {
      return { compatible: false, reason: `Version ${version} is below minimum ${config.minVersion}` }
    }
  }

  if (config.maxVersion) {
    const max = parseVersion(config.maxVersion)
    if (!max) {
      return { compatible: false, reason: `Invalid maximum version: ${config.maxVersion}` }
    }
    if (compareVersions(current, max) > 0) {
      return { compatible: false, reason: `Version ${version} exceeds maximum ${config.maxVersion}` }
    }
  }

  return { compatible: true }
}

function parseVersion(value: string): ParsedVersion | null {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/)

  if (!match) {
    return null
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  if (left.major !== right.major) {
    return left.major - right.major
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor
  }
  return left.patch - right.patch
}
