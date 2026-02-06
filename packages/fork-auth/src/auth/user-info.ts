import { $ } from "bun"

/**
 * UNIX user information from passwd database.
 */
export interface UnixUserInfo {
  username: string
  uid: number
  gid: number
  gecos: string
  home: string
  shell: string
}

/**
 * Look up UNIX user information by username.
 *
 * Uses `getent passwd` on Linux and falls back to `dscl` on macOS.
 * Returns null if user not found or lookup fails.
 *
 * @param username - The username to look up
 * @returns User info or null if not found
 */
export async function getUserInfo(username: string): Promise<UnixUserInfo | null> {
  // Try getent first (works on Linux, some macOS setups)
  const getentResult = await tryGetent(username)
  if (getentResult) {
    return getentResult
  }

  // Fall back to dscl on macOS
  if (process.platform === "darwin") {
    return tryDscl(username)
  }

  return null
}

/**
 * Try to get user info via getent passwd command.
 */
async function tryGetent(username: string): Promise<UnixUserInfo | null> {
  try {
    // getent passwd <username> returns: username:x:uid:gid:gecos:home:shell
    const result = await $`getent passwd ${username}`.quiet().text()
    const line = result.trim()
    if (!line) return null

    const parts = line.split(":")
    if (parts.length < 7) return null

    const uid = parseInt(parts[2], 10)
    const gid = parseInt(parts[3], 10)

    if (Number.isNaN(uid) || Number.isNaN(gid)) return null

    return {
      username: parts[0],
      uid,
      gid,
      gecos: parts[4],
      home: parts[5],
      shell: parts[6],
    }
  } catch {
    return null
  }
}

/**
 * Try to get user info via macOS dscl command.
 *
 * dscl output format:
 *   UniqueID: 501
 *   PrimaryGroupID: 20
 *   NFSHomeDirectory: /Users/username
 *   UserShell: /bin/zsh
 */
async function tryDscl(username: string): Promise<UnixUserInfo | null> {
  try {
    const result = await $`dscl . -read /Users/${username} UniqueID PrimaryGroupID NFSHomeDirectory UserShell`
      .quiet()
      .text()

    const lines = result.trim().split("\n")
    const data: Record<string, string> = {}

    for (const line of lines) {
      const colonIndex = line.indexOf(":")
      if (colonIndex === -1) continue
      const key = line.slice(0, colonIndex).trim()
      const value = line.slice(colonIndex + 1).trim()
      data[key] = value
    }

    const uid = parseInt(data["UniqueID"], 10)
    const gid = parseInt(data["PrimaryGroupID"], 10)
    const home = data["NFSHomeDirectory"]
    const shell = data["UserShell"]

    if (Number.isNaN(uid) || Number.isNaN(gid) || !home || !shell) {
      return null
    }

    return {
      username,
      uid,
      gid,
      gecos: "", // dscl doesn't have gecos equivalent easily accessible
      home,
      shell,
    }
  } catch {
    return null
  }
}
