import { test, expect, describe } from "bun:test"
import { Wildcard } from "../../src/util/wildcard"

describe("pathMatch", () => {
  test("* does not cross directory boundaries", () => {
    expect(Wildcard.pathMatch("/etc/hosts", "/etc/*")).toBe(true)
    expect(Wildcard.pathMatch("/etc/ssh/config", "/etc/*")).toBe(false)
    expect(Wildcard.pathMatch("/tmp/file.txt", "/tmp/*")).toBe(true)
    expect(Wildcard.pathMatch("/tmp/subdir/file.txt", "/tmp/*")).toBe(false)
  })

  test("** matches across directory boundaries", () => {
    expect(Wildcard.pathMatch("/etc/hosts", "/etc/**")).toBe(true)
    expect(Wildcard.pathMatch("/etc/ssh/config", "/etc/**")).toBe(true)
    expect(Wildcard.pathMatch("/etc/ssh/keys/id_rsa", "/etc/**")).toBe(true)
  })

  test("? matches single character but not separator", () => {
    expect(Wildcard.pathMatch("/tmp/a.txt", "/tmp/?.txt")).toBe(true)
    expect(Wildcard.pathMatch("/tmp/ab.txt", "/tmp/?.txt")).toBe(false)
    expect(Wildcard.pathMatch("/t/p/a.txt", "/tmp/?.txt")).toBe(false)
  })

  test("exact matches work", () => {
    expect(Wildcard.pathMatch("/etc/hosts", "/etc/hosts")).toBe(true)
    expect(Wildcard.pathMatch("/etc/passwd", "/etc/hosts")).toBe(false)
  })

  test("handles Windows-style paths", () => {
    expect(Wildcard.pathMatch("C:\\Users\\john\\file.txt", "C:/Users/john/*")).toBe(true)
    expect(Wildcard.pathMatch("C:\\Users\\john\\docs\\file.txt", "C:/Users/john/*")).toBe(false)
    expect(Wildcard.pathMatch("C:\\Users\\john\\docs\\file.txt", "C:/Users/john/**")).toBe(true)
  })
})

describe("pathAll", () => {
  test("picks the most specific matching pattern", () => {
    const rules = {
      "/etc/*": "deny",
      "/etc/hosts": "allow",
    }
    expect(Wildcard.pathAll("/etc/hosts", rules)).toBe("allow")
    expect(Wildcard.pathAll("/etc/passwd", rules)).toBe("deny")
  })

  test("returns undefined when no match", () => {
    const rules = { "/etc/*": "deny" }
    expect(Wildcard.pathAll("/var/log/syslog", rules)).toBeUndefined()
  })

  test("** patterns match subdirectories", () => {
    const rules = {
      "/tmp/*": "allow",
      "/etc/**": "deny",
    }
    expect(Wildcard.pathAll("/etc/ssh/config", rules)).toBe("deny")
    expect(Wildcard.pathAll("/tmp/subdir/file", rules)).toBeUndefined()
  })
})

test("match handles glob tokens", () => {
  expect(Wildcard.match("file1.txt", "file?.txt")).toBe(true)
  expect(Wildcard.match("file12.txt", "file?.txt")).toBe(false)
  expect(Wildcard.match("foo+bar", "foo+bar")).toBe(true)
})

test("all picks the most specific pattern", () => {
  const rules = {
    "*": "deny",
    "git *": "ask",
    "git status": "allow",
  }
  expect(Wildcard.all("git status", rules)).toBe("allow")
  expect(Wildcard.all("git log", rules)).toBe("ask")
  expect(Wildcard.all("echo hi", rules)).toBe("deny")
})

test("allStructured matches command sequences", () => {
  const rules = {
    "git *": "ask",
    "git status*": "allow",
  }
  expect(Wildcard.allStructured({ head: "git", tail: ["status", "--short"] }, rules)).toBe("allow")
  expect(Wildcard.allStructured({ head: "npm", tail: ["run", "build", "--watch"] }, { "npm run *": "allow" })).toBe(
    "allow",
  )
  expect(Wildcard.allStructured({ head: "ls", tail: ["-la"] }, rules)).toBeUndefined()
})

test("allStructured prioritizes flag-specific patterns", () => {
  const rules = {
    "find *": "allow",
    "find * -delete*": "ask",
    "sort*": "allow",
    "sort -o *": "ask",
  }
  expect(Wildcard.allStructured({ head: "find", tail: ["src", "-delete"] }, rules)).toBe("ask")
  expect(Wildcard.allStructured({ head: "find", tail: ["src", "-print"] }, rules)).toBe("allow")
  expect(Wildcard.allStructured({ head: "sort", tail: ["-o", "out.txt"] }, rules)).toBe("ask")
  expect(Wildcard.allStructured({ head: "sort", tail: ["--reverse"] }, rules)).toBe("allow")
})

test("allStructured handles sed flags", () => {
  const rules = {
    "sed * -i*": "ask",
    "sed -n*": "allow",
  }
  expect(Wildcard.allStructured({ head: "sed", tail: ["-i", "file"] }, rules)).toBe("ask")
  expect(Wildcard.allStructured({ head: "sed", tail: ["-i.bak", "file"] }, rules)).toBe("ask")
  expect(Wildcard.allStructured({ head: "sed", tail: ["-n", "1p", "file"] }, rules)).toBe("allow")
  expect(Wildcard.allStructured({ head: "sed", tail: ["-i", "-n", "/./p", "myfile.txt"] }, rules)).toBe("ask")
})
