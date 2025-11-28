/**
 * Secure credential storage for Cerebras
 *
 * Stores user authentication tokens and session data securely
 */

import path from "path"
import { Global } from "../global"
import type { ClerkSession } from "../auth/clerk"

export interface StoredCredentials {
  session?: ClerkSession
  deviceId?: string
  lastLoginAt?: number
  expiresAt?: number
}

export class CredentialStorage {
  private static CREDENTIALS_FILE = "session.json"

  /**
   * Get credentials file path
   */
  private static getPath(): string {
    return path.join(Global.Path.data, this.CREDENTIALS_FILE)
  }

  /**
   * Save session credentials
   */
  static async save(credentials: StoredCredentials): Promise<void> {
    const filePath = this.getPath()

    // Ensure data directory exists
    await Bun.write(filePath, JSON.stringify(credentials, null, 2))

    // Set file permissions to user-only (0600)
    if (process.platform !== "win32") {
      await Bun.spawn(["chmod", "600", filePath]).exited
    }
  }

  /**
   * Load session credentials
   */
  static async load(): Promise<StoredCredentials | null> {
    const filePath = this.getPath()

    try {
      const file = Bun.file(filePath)
      if (!(await file.exists())) {
        return null
      }

      const content = await file.text()
      return JSON.parse(content) as StoredCredentials
    } catch (error) {
      console.error("Failed to load credentials:", error)
      return null
    }
  }

  /**
   * Check if user is authenticated
   */
  static async isAuthenticated(): Promise<boolean> {
    const credentials = await this.load()

    if (!credentials?.session) {
      return false
    }

    // Check if session is expired
    if (credentials.expiresAt && credentials.expiresAt < Date.now()) {
      return false
    }

    return true
  }

  /**
   * Get current session
   */
  static async getSession(): Promise<ClerkSession | null> {
    const credentials = await this.load()
    return credentials?.session || null
  }

  /**
   * Clear all credentials (logout)
   */
  static async clear(): Promise<void> {
    const filePath = this.getPath()

    try {
      const file = Bun.file(filePath)
      if (await file.exists()) {
        await Bun.spawn(["rm", filePath]).exited
      }
    } catch (error) {
      console.error("Failed to clear credentials:", error)
    }
  }

  /**
   * Update session token
   */
  static async updateSession(session: ClerkSession): Promise<void> {
    const existing = (await this.load()) || {}

    await this.save({
      ...existing,
      session,
      expiresAt: session.expiresAt,
      lastLoginAt: Date.now(),
    })
  }

  /**
   * Get or create device ID
   */
  static async getDeviceId(): Promise<string> {
    const credentials = await this.load()

    if (credentials?.deviceId) {
      return credentials.deviceId
    }

    // Generate new device ID
    const deviceId = this.generateDeviceId()

    await this.save({
      ...credentials,
      deviceId,
    })

    return deviceId
  }

  /**
   * Generate a unique device ID
   */
  private static generateDeviceId(): string {
    const timestamp = Date.now().toString(36)
    const random = Math.random().toString(36).substring(2, 15)
    return `${timestamp}-${random}`
  }
}
