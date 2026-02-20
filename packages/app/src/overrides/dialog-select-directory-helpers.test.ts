import { describe, expect, test } from "bun:test"
import { processProjectEntries, validateProjectName, resolveSelection, type FileNode } from "./dialog-select-directory-helpers"

describe("processProjectEntries", () => {
  test("filters to directories only", () => {
    const nodes: FileNode[] = [
      { name: "my-project", absolute: "/home/ubuntu/projects/my-project", type: "directory" },
      { name: "notes.txt", absolute: "/home/ubuntu/projects/notes.txt", type: "file" },
      { name: "other-app", absolute: "/home/ubuntu/projects/other-app", type: "directory" },
    ]

    const result = processProjectEntries(nodes)
    expect(result).toEqual([
      { absolute: "/home/ubuntu/projects/my-project", search: "my-project" },
      { absolute: "/home/ubuntu/projects/other-app", search: "other-app" },
    ])
  })

  test("strips trailing slashes from absolute paths", () => {
    const nodes: FileNode[] = [
      { name: "proj", absolute: "/home/ubuntu/projects/proj/", type: "directory" },
      { name: "proj2", absolute: "/home/ubuntu/projects/proj2///", type: "directory" },
    ]

    const result = processProjectEntries(nodes)
    expect(result).toEqual([
      { absolute: "/home/ubuntu/projects/proj", search: "proj" },
      { absolute: "/home/ubuntu/projects/proj2", search: "proj2" },
    ])
  })

  test("returns empty array for no directories", () => {
    const nodes: FileNode[] = [
      { name: "file.txt", absolute: "/home/ubuntu/projects/file.txt", type: "file" },
    ]
    expect(processProjectEntries(nodes)).toEqual([])
  })

  test("returns empty array for empty input", () => {
    expect(processProjectEntries([])).toEqual([])
  })

  test("uses node name as search field", () => {
    const nodes: FileNode[] = [
      { name: "campaign-dashboard", absolute: "/home/ubuntu/projects/campaign-dashboard", type: "directory" },
    ]
    const result = processProjectEntries(nodes)
    expect(result[0].search).toBe("campaign-dashboard")
  })
})

describe("validateProjectName", () => {
  test("rejects empty string", () => {
    expect(validateProjectName("")).not.toBeNull()
  })

  test("rejects whitespace-only string", () => {
    expect(validateProjectName("   ")).not.toBeNull()
    expect(validateProjectName("\t")).not.toBeNull()
  })

  test("accepts valid project name", () => {
    expect(validateProjectName("my-project")).toBeNull()
  })

  test("accepts name with leading/trailing whitespace (trimmed)", () => {
    expect(validateProjectName("  my-project  ")).toBeNull()
  })
})

describe("resolveSelection", () => {
  test("returns string for single selection", () => {
    const result = resolveSelection("/home/ubuntu/projects/app")
    expect(result).toBe("/home/ubuntu/projects/app")
  })

  test("returns string for explicitly non-multiple", () => {
    const result = resolveSelection("/home/ubuntu/projects/app", false)
    expect(result).toBe("/home/ubuntu/projects/app")
  })

  test("returns array for multiple selection", () => {
    const result = resolveSelection("/home/ubuntu/projects/app", true)
    expect(result).toEqual(["/home/ubuntu/projects/app"])
  })
})
