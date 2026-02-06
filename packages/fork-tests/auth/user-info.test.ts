import { describe, test, expect } from "bun:test"
import { getUserInfo } from "../../../opencode/src/auth/user-info"

describe("getUserInfo", () => {
  test("returns user info for current user", async () => {
    const currentUser = process.env.USER ?? process.env.USERNAME
    if (!currentUser) {
      console.log("Skipping test: no USER env var")
      return
    }

    const info = await getUserInfo(currentUser)

    expect(info).not.toBeNull()
    expect(info?.username).toBe(currentUser)
  })

  test("returns numeric uid and gid", async () => {
    const currentUser = process.env.USER ?? process.env.USERNAME
    if (!currentUser) {
      console.log("Skipping test: no USER env var")
      return
    }

    const info = await getUserInfo(currentUser)

    expect(info).not.toBeNull()
    expect(typeof info?.uid).toBe("number")
    expect(typeof info?.gid).toBe("number")
    expect(Number.isInteger(info?.uid)).toBe(true)
    expect(Number.isInteger(info?.gid)).toBe(true)
  })

  test("returns home directory path starting with /", async () => {
    const currentUser = process.env.USER ?? process.env.USERNAME
    if (!currentUser) {
      console.log("Skipping test: no USER env var")
      return
    }

    const info = await getUserInfo(currentUser)

    expect(info).not.toBeNull()
    expect(info?.home).toMatch(/^\//)
  })

  test("returns shell path starting with /", async () => {
    const currentUser = process.env.USER ?? process.env.USERNAME
    if (!currentUser) {
      console.log("Skipping test: no USER env var")
      return
    }

    const info = await getUserInfo(currentUser)

    expect(info).not.toBeNull()
    expect(info?.shell).toMatch(/^\//)
  })

  test("returns null for non-existent user", async () => {
    const info = await getUserInfo("nonexistent_user_12345_xyz")

    expect(info).toBeNull()
  })

  test("returns null for empty username", async () => {
    const info = await getUserInfo("")

    expect(info).toBeNull()
  })

  test("handles root user lookup", async () => {
    // root user exists on all UNIX systems
    const info = await getUserInfo("root")

    expect(info).not.toBeNull()
    expect(info?.username).toBe("root")
    expect(info?.uid).toBe(0)
    expect(info?.gid).toBe(0)
    expect(info?.home).toMatch(/^\//)
    expect(info?.shell).toMatch(/^\//)
  })
})
