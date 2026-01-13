import { Connection, ConnectionState } from "./connection-manager"
import { ConnectionProfile } from "./profile-manager"
import { SshErrorBucket } from "./types"

export interface DiagnosticExport {
  timestamp: string
  connectionState: ConnectionState
  errorType?: string
  errorMessage?: string
  timing: {
    createdAt: string
    connectedAt?: string
    lastErrorAt?: string
  }
  sanitizedLogs?: string[]
  serverVersion?: string
  localEndpoint?: {
    host: string
    port: number
  }
  redactedProfile?: {
    name: string
    hostHash: string
    userHash?: string
    port?: number
    identityFileBasename?: string
    sshConfigMode?: string
  }
}

const REDACTION_PATTERNS = [
  /-----BEGIN\s+(RSA|DSA|EC|OPENSSH)\s+PRIVATE KEY-----/i,
  /-----END\s+(RSA|DSA|EC|OPENSSH)\s+PRIVATE KEY-----/i,
  /ssh-rsa\s+[A-Za-z0-9+/=]+/,
  /ssh-ed25519\s+[A-Za-z0-9+/=]+/,
  /ecdsa-sha2-nistp\d+\s+[A-Za-z0-9+/=]+/,
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
  /\/[^\s]+/g,
]

const SENSITIVE_FIELDS = [
  "private_key",
  "passphrase",
  "password",
  "secret",
  "token",
  "api_key",
  "credential",
]

function createHash(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(16).padStart(8, "0")
}

function hashValue(value: string): string {
  return `hash_${createHash(value)}`
}

function redactHostname(host: string): string {
  return hashValue(host)
}

function redactUsername(user: string | undefined): string | undefined {
  if (!user) return undefined
  return hashValue(user)
}

function basenameOnly(path: string | undefined): string | undefined {
  if (!path) return undefined
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1]
}

function sanitizeLogs(logs: string[] | undefined): string[] | undefined {
  if (!logs) return undefined
  return logs.map((log) => {
    let sanitized = log
    for (const pattern of REDACTION_PATTERNS) {
      sanitized = sanitized.replace(pattern, "[REDACTED]")
    }
    for (const field of SENSITIVE_FIELDS) {
      const regex = new RegExp(`\\b${field}\\s*[:=]\\s*[^\\s]+`, "gi")
      sanitized = sanitized.replace(regex, `${field}=[REDACTED]`)
    }
    return sanitized
  })
}

function scanForLeaks(content: string): string[] {
  const leaks: string[] = []
  
  for (const pattern of REDACTION_PATTERNS) {
    if (pattern.test(content)) {
      leaks.push(`Found sensitive pattern: ${pattern.source}`)
    }
  }
  
  for (const field of SENSITIVE_FIELDS) {
    const regex = new RegExp(`\\b${field}\\s*[:=]\\s*[^\\s]+`, "gi")
    if (regex.test(content)) {
      leaks.push(`Found sensitive field: ${field}`)
    }
  }
  
  const ipPattern = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/
  if (ipPattern.test(content)) {
    leaks.push("Found IP address")
  }
  
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
  if (emailPattern.test(content)) {
    leaks.push("Found email address")
  }
  
  const pathPattern = /\/[^\s]+/
  if (pathPattern.test(content)) {
    const matches = content.match(pathPattern)
    if (matches) {
      for (const match of matches) {
        if (match.length > 20 && !match.includes("[REDACTED]")) {
          leaks.push(`Found long file path: ${match.substring(0, 50)}...`)
        }
      }
    }
  }
  
  return leaks
}

export function exportDiagnostics(
  connection: Connection,
  profile?: ConnectionProfile
): DiagnosticExport {
  const exportData: DiagnosticExport = {
    timestamp: new Date().toISOString(),
    connectionState: connection.state,
    timing: {
      createdAt: connection.createdAt,
      connectedAt: connection.connectedAt,
      lastErrorAt: connection.error?.timestamp,
    },
  }
  
  if (connection.error) {
    exportData.errorType = connection.error.type
    exportData.errorMessage = connection.error.message
  }
  
  if (connection.serverInfo) {
    exportData.serverVersion = connection.serverInfo.version
  }
  
  if (connection.localEndpoint) {
    exportData.localEndpoint = {
      host: connection.localEndpoint.host,
      port: connection.localEndpoint.port,
    }
  }
  
  if (profile) {
    exportData.redactedProfile = {
      name: profile.name,
      hostHash: redactHostname(profile.host),
      userHash: redactUsername(profile.user),
      port: profile.port,
      identityFileBasename: basenameOnly(profile.identityFile),
      sshConfigMode: profile.sshConfigMode,
    }
  }
  
  if (connection.error?.sshStderr) {
    exportData.sanitizedLogs = sanitizeLogs([connection.error.sshStderr])
  }
  
  return exportData
}

export function verifyRedaction(exportData: DiagnosticExport): {
  passed: boolean
  leaks: string[]
} {
  const jsonString = JSON.stringify(exportData, null, 2)
  const leaks = scanForLeaks(jsonString)
  
  return {
    passed: leaks.length === 0,
    leaks,
  }
}

export function copyDiagnostics(connection: Connection, profile?: ConnectionProfile): string {
  const exportData = exportDiagnostics(connection, profile)
  const verification = verifyRedaction(exportData)
  
  if (!verification.passed) {
    throw new Error(`Diagnostics export failed redaction check: ${verification.leaks.join(", ")}`)
  }
  
  return JSON.stringify(exportData, null, 2)
}
