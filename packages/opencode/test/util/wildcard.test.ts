import { test, expect } from "bun:test"
import { Wildcard } from "../../src/util/wildcard"

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

// Cross-platform path separator tests
test("match handles Windows paths with forward slash patterns", () => {
  // Unix config pattern matching Windows path
  expect(Wildcard.match("openspec\\api.yaml", "openspec/*")).toBe(true)
  expect(Wildcard.match("src\\main.ts", "src/*")).toBe(true)
  expect(Wildcard.match("C:\\Users\\name\\file.txt", "C:/*")).toBe(true)
  expect(Wildcard.match("openspec\\sub\\file.txt", "openspec/*")).toBe(true)
})

test("match handles Windows paths with backslash patterns", () => {
  // Windows config pattern matching Windows path
  expect(Wildcard.match("openspec\\api.yaml", "openspec\\*")).toBe(true)
  expect(Wildcard.match("src\\main.ts", "src\\*")).toBe(true)
  expect(Wildcard.match("C:\\Users\\name\\file.txt", "C:\\*")).toBe(true)
})

test("match handles Unix paths with backslash patterns", () => {
  // Windows config pattern matching Unix path
  expect(Wildcard.match("openspec/api.yaml", "openspec\\*")).toBe(true)
  expect(Wildcard.match("src/main.ts", "src\\*")).toBe(true)
})

test("match handles mixed separators", () => {
  expect(Wildcard.match("openspec\\sub/file.txt", "openspec/*")).toBe(true)
  expect(Wildcard.match("src/sub\\file.txt", "src\\*")).toBe(true)
})

test("match handles UNC paths", () => {
  expect(Wildcard.match("\\\\server\\share\\file.txt", "//server/share/*")).toBe(true)
  expect(Wildcard.match("//server/share/file.txt", "\\\\server\\share\\*")).toBe(true)
  expect(Wildcard.match("\\\\server\\share\\sub\\file.txt", "//server/share/*")).toBe(true)
})

test("match handles drive letters", () => {
  expect(Wildcard.match("C:\\Users\\name\\file.txt", "C:/*")).toBe(true)
  expect(Wildcard.match("D:\\project\\src\\main.ts", "D:/project/*")).toBe(true)
  expect(Wildcard.match("C:/Users/name/file.txt", "C:\\*")).toBe(true)
})

test("match handles relative vs absolute paths", () => {
  // Relative paths
  expect(Wildcard.match("src\\main.ts", "src/*")).toBe(true)
  expect(Wildcard.match("src/main.ts", "src\\*")).toBe(true)

  // Absolute paths
  expect(Wildcard.match("/home/user/project/src/main.ts", "/home/user/project/src/*")).toBe(true)
  expect(Wildcard.match("\\home\\user\\project\\src\\main.ts", "/home/user/project/src/*")).toBe(true)
})

test("match handles complex patterns with Windows paths", () => {
  expect(Wildcard.match("openspec\\api.yaml", "openspec/*.yaml")).toBe(true)
  expect(Wildcard.match("openspec\\sub\\test.ts", "openspec/*/test.ts")).toBe(true)
  expect(Wildcard.match("src\\components\\Button.tsx", "src/components/*.tsx")).toBe(true)
  expect(Wildcard.match("C:\\project\\src\\test.ts", "C:/project/src/test.ts")).toBe(true)
})

test("match handles wildcards with Windows paths", () => {
  expect(Wildcard.match("openspec\\file1.txt", "openspec/*")).toBe(true)
  expect(Wildcard.match("openspec\\sub\\file2.txt", "openspec/**")).toBe(true)
  expect(Wildcard.match("src\\test\\file.ts", "src/*/file.ts")).toBe(true)
})

test("match handles question mark with Windows paths", () => {
  expect(Wildcard.match("file\\1.txt", "file\\?.txt")).toBe(true)
  expect(Wildcard.match("file\\12.txt", "file\\?.txt")).toBe(false)
  expect(Wildcard.match("file/1.txt", "file\\?.txt")).toBe(true)
})

test("match handles special regex chars in Windows paths", () => {
  // These should be escaped properly
  expect(Wildcard.match("src\\file+more.txt", "src/file+more.txt")).toBe(true)
  expect(Wildcard.match("src\\file[1-3].txt", "src/file[1-3].txt")).toBe(true)
  expect(Wildcard.match("src\\file.txt", "src/file.txt")).toBe(true)
})

test("match handles empty strings and patterns", () => {
  expect(Wildcard.match("", "")).toBe(true)
  expect(Wildcard.match("\\", "/")).toBe(true)
  expect(Wildcard.match("/", "\\")).toBe(true)
})
