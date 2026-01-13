import { describe, test, expect } from "bun:test"
import { Connection, ConnectionState } from "../connection-manager"
import { ConnectionProfile } from "../profile-manager"
import { exportDiagnostics, verifyRedaction, copyDiagnostics } from "../diagnostics"

describe("Diagnostics Export and Redaction", () => {
  const baseConnection: Connection = {
    id: "conn-123",
    profileId: "profile-456",
    state: ConnectionState.Connected,
    createdAt: "2024-01-01T00:00:00Z",
    connectedAt: "2024-01-01T00:01:00Z",
    localEndpoint: {
      host: "127.0.0.1",
      port: 8080,
    },
    serverInfo: {
      healthy: true,
      version: "1.0.0",
    },
  }

  const baseProfile: ConnectionProfile = {
    id: "profile-456",
    name: "Test Profile",
    host: "example.com",
    user: "alice",
    port: 22,
    identityFile: "/home/alice/.ssh/id_rsa",
    remoteServerPorts: [8080],
    remoteHost: "127.0.0.1",
    bootstrapEnabled: false,
    autoReconnect: true,
    createdAt: "2024-01-01T00:00:00Z",
  }

  describe("Property 15: Diagnostic Security and Redaction", () => {
    test("exports connection state and timing", () => {
      const exportData = exportDiagnostics(baseConnection)
      
      expect(exportData.connectionState).toEqual(ConnectionState.Connected)
      expect(exportData.timing.createdAt).toBeDefined()
      expect(exportData.timing.connectedAt).toBeDefined()
    })

    test("redacts hostname in profile", () => {
      const exportData = exportDiagnostics(baseConnection, baseProfile)
      
      expect(exportData.redactedProfile).toBeDefined()
      expect(exportData.redactedProfile?.hostHash).not.toEqual(baseProfile.host)
      expect(exportData.redactedProfile?.hostHash).toMatch(/^hash_[0-9a-f]+$/)
    })

    test("redacts username in profile", () => {
      const exportData = exportDiagnostics(baseConnection, baseProfile)
      
      expect(exportData.redactedProfile?.userHash).not.toEqual(baseProfile.user)
      expect(exportData.redactedProfile?.userHash).toMatch(/^hash_[0-9a-f]+$/)
    })

    test("includes only basename of identity file", () => {
      const exportData = exportDiagnostics(baseConnection, baseProfile)
      
      expect(exportData.redactedProfile?.identityFileBasename).toEqual("id_rsa")
      expect(exportData.redactedProfile?.identityFileBasename).not.toContain("/home")
      expect(exportData.redactedProfile?.identityFileBasename).not.toContain("alice")
    })

    test("sanitizes SSH stderr logs", () => {
      const connectionWithError: Connection = {
        ...baseConnection,
        state: ConnectionState.Failed,
        error: {
          type: "auth_error",
          message: "Authentication failed",
          sshStderr: "Permission denied (publickey).\nHost key: ssh-rsa AAAAB3NzaC1yc2E...",
          timestamp: "2024-01-01T00:02:00Z",
        },
      }
      
      const exportData = exportDiagnostics(connectionWithError)
      
      expect(exportData.sanitizedLogs).toBeDefined()
      if (exportData.sanitizedLogs) {
        const logText = exportData.sanitizedLogs.join("\n")
        expect(logText).not.toContain("ssh-rsa")
        expect(logText).toContain("[REDACTED]")
      }
    })

    test("verification passes for properly redacted export", () => {
      const exportData = exportDiagnostics(baseConnection, baseProfile)
      const verification = verifyRedaction(exportData)
      
      expect(verification.passed).toBe(true)
      expect(verification.leaks.length).toEqual(0)
    })

    test("verification fails for unredacted sensitive data", () => {
      const maliciousExport: any = {
        timestamp: new Date().toISOString(),
        connectionState: ConnectionState.Connected,
        redactedProfile: {
          name: "Test",
          hostHash: "hash_123",
          host: "example.com",
        },
        sensitiveData: "ssh-rsa AAAAB3NzaC1yc2E...",
      }
      
      const verification = verifyRedaction(maliciousExport)
      
      expect(verification.passed).toBe(false)
      expect(verification.leaks.length).toBeGreaterThan(0)
    })

    test("copyDiagnostics returns valid JSON", () => {
      const json = copyDiagnostics(baseConnection, baseProfile)
      
      expect(() => JSON.parse(json)).not.toThrow()
      const parsed = JSON.parse(json)
      expect(parsed.connectionState).toBeDefined()
      expect(parsed.timestamp).toBeDefined()
    })

    test("copyDiagnostics throws if redaction fails", () => {
      const maliciousConnection: Connection = {
        ...baseConnection,
        error: {
          type: "auth_error",
          message: "Failed",
          sshStderr: "ssh-rsa AAAAB3NzaC1yc2E...",
          timestamp: new Date().toISOString(),
        },
      }
      
      expect(() => {
        copyDiagnostics(maliciousConnection, baseProfile)
      }).toThrow()
    })
  })

  describe("Property 14: Error Reporting Completeness", () => {
    test("includes error type and message", () => {
      const connectionWithError: Connection = {
        ...baseConnection,
        state: ConnectionState.Failed,
        error: {
          type: "auth_error",
          message: "Authentication failed",
          details: "Permission denied",
          timestamp: "2024-01-01T00:02:00Z",
        },
      }
      
      const exportData = exportDiagnostics(connectionWithError)
      
      expect(exportData.errorType).toEqual("auth_error")
      expect(exportData.errorMessage).toEqual("Authentication failed")
      expect(exportData.timing.lastErrorAt).toBeDefined()
    })

    test("includes server version when available", () => {
      const exportData = exportDiagnostics(baseConnection)
      
      expect(exportData.serverVersion).toEqual("1.0.0")
    })

    test("includes local endpoint when connected", () => {
      const exportData = exportDiagnostics(baseConnection)
      
      expect(exportData.localEndpoint).toBeDefined()
      expect(exportData.localEndpoint?.host).toEqual("127.0.0.1")
      expect(exportData.localEndpoint?.port).toEqual(8080)
    })

    test("handles missing optional fields gracefully", () => {
      const minimalConnection: Connection = {
        id: "conn-min",
        profileId: "profile-min",
        state: ConnectionState.Idle,
        createdAt: "2024-01-01T00:00:00Z",
      }
      
      const exportData = exportDiagnostics(minimalConnection)
      
      expect(exportData.connectionState).toEqual(ConnectionState.Idle)
      expect(exportData.timing.createdAt).toBeDefined()
      expect(exportData.serverVersion).toBeUndefined()
      expect(exportData.localEndpoint).toBeUndefined()
    })

    test("preserves profile name without redaction", () => {
      const exportData = exportDiagnostics(baseConnection, baseProfile)
      
      expect(exportData.redactedProfile?.name).toEqual("Test Profile")
    })

    test("includes SSH config mode when present", () => {
      const profileWithConfig: ConnectionProfile = {
        ...baseProfile,
        sshConfigMode: "isolation",
      }
      
      const exportData = exportDiagnostics(baseConnection, profileWithConfig)
      
      expect(exportData.redactedProfile?.sshConfigMode).toEqual("isolation")
    })
  })

  describe("Redaction Edge Cases", () => {
    test("handles undefined user gracefully", () => {
      const profileNoUser: ConnectionProfile = {
        ...baseProfile,
        user: undefined,
      }
      
      const exportData = exportDiagnostics(baseConnection, profileNoUser)
      
      expect(exportData.redactedProfile?.userHash).toBeUndefined()
    })

    test("handles undefined identity file gracefully", () => {
      const profileNoIdentity: ConnectionProfile = {
        ...baseProfile,
        identityFile: undefined,
      }
      
      const exportData = exportDiagnostics(baseConnection, profileNoIdentity)
      
      expect(exportData.redactedProfile?.identityFileBasename).toBeUndefined()
    })

    test("handles Windows paths correctly", () => {
      const profileWindows: ConnectionProfile = {
        ...baseProfile,
        identityFile: "C:\\Users\\alice\\.ssh\\id_rsa",
      }
      
      const exportData = exportDiagnostics(baseConnection, profileWindows)
      
      expect(exportData.redactedProfile?.identityFileBasename).toEqual("id_rsa")
    })

    test("handles complex file paths", () => {
      const profileComplex: ConnectionProfile = {
        ...baseProfile,
        identityFile: "/home/user/.ssh/keys/production/id_rsa",
      }
      
      const exportData = exportDiagnostics(baseConnection, profileComplex)
      
      expect(exportData.redactedProfile?.identityFileBasename).toEqual("id_rsa")
    })
  })

  describe("Leak Detection", () => {
    test("detects SSH private keys", () => {
      const content = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA..."
      const leaks = verifyRedaction({ timestamp: new Date().toISOString(), connectionState: ConnectionState.Connected, sensitive: content } as any)
      
      expect(leaks.passed).toBe(false)
      expect(leaks.leaks.length).toBeGreaterThan(0)
    })

    test("detects email addresses", () => {
      const content = "user@example.com"
      const leaks = verifyRedaction({ timestamp: new Date().toISOString(), connectionState: ConnectionState.Connected, email: content } as any)
      
      expect(leaks.passed).toBe(false)
    })

    test("detects IP addresses", () => {
      const content = "192.168.1.1"
      const leaks = verifyRedaction({ timestamp: new Date().toISOString(), connectionState: ConnectionState.Connected, ip: content } as any)
      
      expect(leaks.passed).toBe(false)
    })

    test("detects long file paths", () => {
      const content = "/very/long/path/to/sensitive/file/that/should/be/redacted"
      const leaks = verifyRedaction({ timestamp: new Date().toISOString(), connectionState: ConnectionState.Connected, path: content } as any)
      
      expect(leaks.passed).toBe(false)
    })
  })
})
