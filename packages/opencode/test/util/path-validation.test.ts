import { test, expect, describe } from "bun:test"
import {
  hasShellExpansion,
  hasTraversal,
  isDangerousDirectory,
  validatePath,
  validatePathOrThrow,
  isPathAutoApprovable,
  getPathApprovalReason,
} from "../../src/util/path-validation"

describe("hasShellExpansion", () => {
  test("detects $VAR expansion", () => {
    const result = hasShellExpansion("/home/user/$HOME/file.txt")
    expect(result.has).toBe(true)
  })

  test("detects ${VAR} expansion", () => {
    const result = hasShellExpansion("/home/user/${HOME}/file.txt")
    expect(result.has).toBe(true)
  })

  test("detects command substitution $()", () => {
    const result = hasShellExpansion("/home/user/$(whoami)/file.txt")
    expect(result.has).toBe(true)
  })

  test("detects backtick command substitution", () => {
    const result = hasShellExpansion("/home/user/`whoami`/file.txt")
    expect(result.has).toBe(true)
  })

  test("detects Windows %VAR% expansion", () => {
    const result = hasShellExpansion("C:\\Users\\%USERNAME%\\file.txt")
    expect(result.has).toBe(true)
  })

  test("detects ~ expansion", () => {
    const result = hasShellExpansion("~/file.txt")
    expect(result.has).toBe(true)
  })

  test("detects ** wildcard outside directory", () => {
    const result = hasShellExpansion("/home/user/**/file.txt")
    expect(result.has).toBe(true)
  })

  test("allows normal paths", () => {
    const result = hasShellExpansion("/home/user/file.txt")
    expect(result.has).toBe(false)
  })

  test("allows single * glob", () => {
    const result = hasShellExpansion("/home/user/*.txt")
    expect(result.has).toBe(false)
  })
})

describe("hasTraversal", () => {
  test("detects simple .. traversal", () => {
    expect(hasTraversal("../file.txt")).toBe(true)
  })

  test("detects nested .. traversal", () => {
    expect(hasTraversal("../../file.txt")).toBe(true)
  })

  test("detects .. in middle of path", () => {
    expect(hasTraversal("/home/user/../other/file.txt")).toBe(true)
  })

  test("detects complex .. patterns", () => {
    expect(hasTraversal("/home/user/../../../etc/passwd")).toBe(true)
  })

  test("allows paths without ..", () => {
    expect(hasTraversal("/home/user/file.txt")).toBe(false)
  })

  test("allows relative paths without ..", () => {
    expect(hasTraversal("subdir/file.txt")).toBe(false)
  })
})

describe("isDangerousDirectory", () => {
  test("detects .git directory", () => {
    expect(isDangerousDirectory("/project/.git/config")).toBe(".git directory")
    expect(isDangerousDirectory(".git/HEAD")).toBe(".git directory")
  })

  test("detects .bashrc", () => {
    expect(isDangerousDirectory("/home/user/.bashrc")).toBe(".bashrc")
  })

  test("detects .zshrc", () => {
    expect(isDangerousDirectory("/home/user/.zshrc")).toBe(".zshrc")
  })

  test("detects .profile", () => {
    expect(isDangerousDirectory("/home/user/.profile")).toBe(".profile")
  })

  test("detects .ssh directory", () => {
    expect(isDangerousDirectory("/home/user/.ssh/id_rsa")).toBe(".ssh directory")
  })

  test("detects .env files", () => {
    expect(isDangerousDirectory("/project/.env")).toBe(".env file")
    expect(isDangerousDirectory("/project/.env.local")).toBe(".env.* file")
  })

  test("allows normal files", () => {
    expect(isDangerousDirectory("/project/src/index.ts")).toBe(null)
    expect(isDangerousDirectory("/home/user/project/file.txt")).toBe(null)
  })

  test("detects fish config", () => {
    expect(isDangerousDirectory("/home/user/.config/fish/config.fish")).toBe("fish config")
  })
})

describe("validatePath", () => {
  const workingDir = "/tmp/test-project"

  test("rejects paths with $VAR", async () => {
    const result = await validatePath("/home/user/$HOME/file.txt", {
      workingDirectory: workingDir,
      enforceWorkingDirectory: false,
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("shell expansion")
  })

  test("rejects paths with ${VAR}", async () => {
    const result = await validatePath("/home/user/${HOME}/file.txt", {
      workingDirectory: workingDir,
      enforceWorkingDirectory: false,
    })
    expect(result.valid).toBe(false)
  })

  test("rejects paths with command substitution", async () => {
    const result = await validatePath("/home/user/$(whoami)/file.txt", {
      workingDirectory: workingDir,
      enforceWorkingDirectory: false,
    })
    expect(result.valid).toBe(false)
  })

  test("warns about .. sequences", async () => {
    const result = await validatePath("../file.txt", {
      workingDirectory: workingDir,
      enforceWorkingDirectory: true,
      resolveSymlinks: false,
    })
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings.some(w => w.includes("'..'"))).toBe(true)
  })

  test("warns about .git directory", async () => {
    const result = await validatePath(".git/config", {
      workingDirectory: workingDir,
      enforceWorkingDirectory: false,
      resolveSymlinks: false,
    })
    expect(result.dangerousDirectory).toBe(".git directory")
    expect(result.warnings.some(w => w.includes("protected location"))).toBe(true)
  })

  test("warns about .bashrc", async () => {
    const result = await validatePath("/home/user/.bashrc", {
      workingDirectory: workingDir,
      enforceWorkingDirectory: false,
      resolveSymlinks: false,
    })
    expect(result.dangerousDirectory).toBe(".bashrc")
  })

  test("accepts normal absolute paths", async () => {
    const result = await validatePath("/tmp/test.txt", {
      workingDirectory: workingDir,
      enforceWorkingDirectory: false,
      resolveSymlinks: false,
    })
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  test("accepts relative paths", async () => {
    const result = await validatePath("src/index.ts", {
      workingDirectory: workingDir,
      enforceWorkingDirectory: false,
      resolveSymlinks: false,
    })
    expect(result.valid).toBe(true)
  })
})

describe("validatePathOrThrow", () => {
  const workingDir = "/tmp/test-project"

  test("throws on invalid paths", async () => {
    await expect(
      validatePathOrThrow("/home/user/$HOME/file.txt", { workingDirectory: workingDir }),
    ).rejects.toThrow("Path validation failed")
  })

  test("returns resolved path on valid inputs", async () => {
    const resolved = await validatePathOrThrow("/tmp/test.txt", {
      workingDirectory: workingDir,
      enforceWorkingDirectory: false,
      resolveSymlinks: false,
    })
    expect(resolved).toBe("/tmp/test.txt")
  })
})

describe("isPathAutoApprovable", () => {
  test("returns false for dangerous directories", () => {
    expect(isPathAutoApprovable(".git/config")).toBe(false)
    expect(isPathAutoApprovable(".bashrc")).toBe(false)
  })

  test("returns false for shell expansions", () => {
    expect(isPathAutoApprovable("/home/user/$HOME")).toBe(false)
  })

  test("returns false for traversal sequences", () => {
    expect(isPathAutoApprovable("../../../etc/passwd")).toBe(false)
  })

  test("returns true for safe paths", () => {
    expect(isPathAutoApprovable("/home/user/project/src/index.ts")).toBe(true)
    expect(isPathAutoApprovable("src/index.ts")).toBe(true)
  })
})

describe("getPathApprovalReason", () => {
  test("returns reason for dangerous directories", () => {
    const reason = getPathApprovalReason(".git/config")
    expect(reason).toContain("protected location")
  })

  test("returns reason for shell expansion", () => {
    const reason = getPathApprovalReason("/home/user/$HOME")
    expect(reason).toContain("shell expansion")
  })

  test("returns reason for traversal", () => {
    const reason = getPathApprovalReason("../file.txt")
    expect(reason).toContain("traversal")
  })

  test("returns null for safe paths", () => {
    const reason = getPathApprovalReason("/home/user/project/src/index.ts")
    expect(reason).toBeNull()
  })
})
