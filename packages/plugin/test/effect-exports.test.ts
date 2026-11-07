import { expect, test } from "bun:test"
import { Tool as SchemaTool } from "@opencode/schema/tool"
import { Tool } from "../src/effect/index.js"

test("Effect plugins get the host's Tool, so an execute.before hook can refuse with Tool.Error", () => {
  expect(Tool.Error).toBe(SchemaTool.Error)
  expect(new Tool.Error({ message: "refused" })._tag).toBe("Tool.Error")
})
