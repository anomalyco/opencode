export interface SshConfigHost {
  name: string
  host: string
  user?: string
  port?: number
  identityFile?: string
  proxyJump?: string
  forwardAgent?: boolean
  compression?: boolean
  controlMaster?: string
  controlPath?: string
  serverAliveInterval?: number
  serverAliveCountMax?: number
}

export interface SshConfigParseResult {
  success: true
  hosts: SshConfigHost[]
}

export interface SshConfigParseError {
  success: false
  message: string
  details?: string
  line?: number
}

interface ParsedHost {
  patterns: string[]
  hostname?: string
  user?: string
  port?: number
  identityFile?: string
  proxyJump?: string
  forwardAgent?: boolean
  compression?: boolean
  controlMaster?: string
  controlPath?: string
  serverAliveInterval?: number
  serverAliveCountMax?: number
}

function expandTilde(path: string): string {
  if (path.startsWith("~/")) {
    const home = process.env.HOME || process.env.USERPROFILE || ""
    return home + path.slice(1)
  }
  return path
}

function parseValue(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

function parseBoolean(value: string): boolean {
  const lower = value.toLowerCase()
  return lower === "yes" || lower === "true" || lower === "1"
}

function parseNumber(value: string): number | undefined {
  const num = parseInt(value, 10)
  return isNaN(num) ? undefined : num
}

export async function parseSshConfig(
  configPath?: string
): Promise<SshConfigParseResult | SshConfigParseError> {
  const path = configPath || getDefaultConfigPath()

  try {
    const content = await readConfigFile(path)
    return await parseConfigContent(content, path)
  } catch (error) {
    return {
      success: false,
      message: "Failed to read SSH config file",
      details: error instanceof Error ? error.message : String(error),
    }
  }
}

function resolveIncludePath(includePath: string, baseDir: string): string {
  if (includePath.startsWith("/") || includePath.startsWith("~")) {
    return includePath
  }
  if (baseDir) {
    return baseDir + includePath
  }
  return includePath
}

function getDefaultConfigPath(): string {
  if (typeof process !== "undefined" && process.platform === "win32") {
    return "~/.ssh/config"
  }
  return "~/.ssh/config"
}

async function readConfigFile(path: string): Promise<string> {
  try {
    const { readTextFile, BaseDirectory } = await import("@tauri-apps/api/fs" as any)
    
    if (path.startsWith("~")) {
      const home = process.env.HOME || process.env.USERPROFILE || ""
      path = path.replace("~", home)
    }
    
    try {
      return await readTextFile(path)
    } catch {
      const normalized = path.replace(/^~/, "")
      return await readTextFile(normalized, { dir: BaseDirectory.Home })
    }
  } catch (error) {
    throw new Error(`Failed to read SSH config file: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function parseConfigContent(content: string, configPath?: string): Promise<SshConfigParseResult | SshConfigParseError> {
  const hosts: SshConfigHost[] = []
  const parsedHosts: ParsedHost[] = []
  let currentHost: ParsedHost | null = null
  let lineNumber = 0

  const lines = content.split("\n")
  const baseDir = configPath ? configPath.substring(0, configPath.lastIndexOf("/") + 1) : ""
  const processedIncludes = new Set<string>()

  for (const line of lines) {
    lineNumber++
    const trimmed = line.trim()

    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue
    }

    const parts = splitConfigLine(trimmed)
    if (parts.length === 0) {
      continue
    }

    const key = parts[0].toLowerCase()
    const value = parts.length > 1 ? parts.slice(1).join(" ") : ""

    switch (key) {
      case "host": {
        if (currentHost) {
          parsedHosts.push(currentHost)
        }
        const patterns = value.split(/\s+/).filter((p) => p.length > 0)
        currentHost = {
          patterns,
        }
        break
      }

      case "hostname": {
        if (currentHost) {
          currentHost.hostname = parseValue(value)
        }
        break
      }

      case "user":
      case "user": {
        if (currentHost) {
          currentHost.user = parseValue(value)
        }
        break
      }

      case "port": {
        if (currentHost) {
          currentHost.port = parseNumber(value)
        }
        break
      }

      case "identityfile": {
        if (currentHost) {
          const file = expandTilde(parseValue(value))
          if (currentHost.identityFile) {
            currentHost.identityFile = [currentHost.identityFile, file].join(" ")
          } else {
            currentHost.identityFile = file
          }
        }
        break
      }

      case "proxyjump":
      case "jumphost": {
        if (currentHost) {
          currentHost.proxyJump = parseValue(value)
        }
        break
      }

      case "forwardagent": {
        if (currentHost) {
          currentHost.forwardAgent = parseBoolean(value)
        }
        break
      }

      case "compression": {
        if (currentHost) {
          currentHost.compression = parseBoolean(value)
        }
        break
      }

      case "controlmaster": {
        if (currentHost) {
          currentHost.controlMaster = parseValue(value)
        }
        break
      }

      case "controlpath": {
        if (currentHost) {
          currentHost.controlPath = expandTilde(parseValue(value))
        }
        break
      }

      case "serveraliveinterval": {
        if (currentHost) {
          currentHost.serverAliveInterval = parseNumber(value)
        }
        break
      }

      case "serveralivecountmax": {
        if (currentHost) {
          currentHost.serverAliveCountMax = parseNumber(value)
        }
        break
      }

      case "include": {
        if (value) {
          const includePaths = value.split(/\s+/).filter((p) => p.length > 0)
          for (const includePath of includePaths) {
            const resolvedPath = resolveIncludePath(includePath, baseDir)
            if (processedIncludes.has(resolvedPath)) {
              continue
            }
            processedIncludes.add(resolvedPath)
            
            try {
              const includeContent = await readConfigFile(resolvedPath)
              const includeResult = await parseConfigContent(includeContent, resolvedPath)
              if (includeResult.success) {
                for (const host of includeResult.hosts) {
                  const parsed: ParsedHost = {
                    patterns: [host.name],
                    hostname: host.host,
                    user: host.user,
                    port: host.port,
                    identityFile: host.identityFile,
                    proxyJump: host.proxyJump,
                    forwardAgent: host.forwardAgent,
                    compression: host.compression,
                    controlMaster: host.controlMaster,
                    controlPath: host.controlPath,
                    serverAliveInterval: host.serverAliveInterval,
                    serverAliveCountMax: host.serverAliveCountMax,
                  }
                  parsedHosts.push(parsed)
                }
              }
            } catch (error) {
              console.warn(`Failed to include SSH config file: ${resolvedPath}`, error)
            }
          }
        }
        break
      }

      default:
        break
    }
  }

  if (currentHost) {
    parsedHosts.push(currentHost)
  }

  for (const parsed of parsedHosts) {
    for (const pattern of parsed.patterns) {
      if (pattern === "*") {
        continue
      }

      const host: SshConfigHost = {
        name: pattern,
        host: parsed.hostname || pattern,
        user: parsed.user,
        port: parsed.port,
        identityFile: parsed.identityFile,
        proxyJump: parsed.proxyJump,
        forwardAgent: parsed.forwardAgent,
        compression: parsed.compression,
        controlMaster: parsed.controlMaster,
        controlPath: parsed.controlPath,
        serverAliveInterval: parsed.serverAliveInterval,
        serverAliveCountMax: parsed.serverAliveCountMax,
      }

      hosts.push(host)
    }
  }

  hosts.sort((a, b) => a.name.localeCompare(b.name))

  return {
    success: true,
    hosts,
  }
}

function splitConfigLine(line: string): string[] {
  const parts: string[] = []
  let current = ""
  let inQuotes = false
  let quoteChar = ""

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (!inQuotes && (char === '"' || char === "'")) {
      inQuotes = true
      quoteChar = char
      continue
    }

    if (inQuotes && char === quoteChar) {
      inQuotes = false
      quoteChar = ""
      continue
    }

    if (!inQuotes && /\s/.test(char)) {
      if (current.length > 0) {
        parts.push(current)
        current = ""
      }
      continue
    }

    current += char
  }

  if (current.length > 0) {
    parts.push(current)
  }

  return parts
}

export async function listSshConfigHosts(): Promise<SshConfigHost[]> {
  const result = await parseSshConfig()
  if (result.success) {
    return result.hosts
  }
  return []
}
