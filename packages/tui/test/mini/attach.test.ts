import { describe, expect, test } from "bun:test"
import { split } from "../../../src/cli/cmd/run/attach"

describe("run.attach.split", () => {
  test("returns nothing for an omitted flag", () => {
    expect(split()).toEqual({ server: undefined, paths: [] })
  })

  test("treats http and https values as the server", () => {
    expect(split(["http://localhost:4096"])).toEqual({ server: "http://localhost:4096", paths: [] })
    expect(split(["https://bolt.example.com"])).toEqual({ server: "https://bolt.example.com", paths: [] })
  })

  test("treats non-URL values as context paths", () => {
    expect(split(["./src", "notes.md"])).toEqual({ server: undefined, paths: ["./src", "notes.md"] })
  })

  test("mixes a server with context paths", () => {
    expect(split(["http://localhost:4096", "./src"])).toEqual({
      server: "http://localhost:4096",
      paths: ["./src"],
    })
  })

  test("accepts a single string value", () => {
    expect(split("http://localhost:4096")).toEqual({ server: "http://localhost:4096", paths: [] })
    expect(split("./src")).toEqual({ server: undefined, paths: ["./src"] })
  })

  test("rejects more than one server URL", () => {
    expect(split(["http://a", "http://b"]).error).toBeDefined()
  })
})
