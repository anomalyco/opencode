import { describe, test, expect, afterAll } from "bun:test"
import path from "path"
import fs from "fs/promises"
import os from "os"
import * as LSPServer from "@/lsp/server"
import type { InstanceContext } from "@/project/instance-context"

const tmpBase = path.join(os.tmpdir(), "opencode-graphql-test")

function makeCtx(directory: string): InstanceContext {
  return { directory, worktree: "/", project: {} as any }
}

async function touch(p: string) {
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, "", "utf-8")
}

afterAll(async () => {
  await fs.rm(tmpBase, { recursive: true, force: true }).catch(() => {})
})

describe("GraphQL", () => {
  test("handles .graphql and .gql files", () => {
    expect(LSPServer.GraphQL.extensions).toEqual([".graphql", ".gql"])
  })

  test("nearest graphql config wins over the workspace root", async () => {
    const workspace = path.join(tmpBase, "config-in-subdir")
    const projectDir = path.join(workspace, "api")
    await touch(path.join(projectDir, ".graphqlrc.yml"))
    await touch(path.join(projectDir, "schema.graphql"))

    const result = await LSPServer.GraphQL.root(path.join(projectDir, "schema.graphql"), makeCtx(workspace))
    expect(result).toBe(projectDir)
  })

  test("graphql.config.ts is recognized", async () => {
    const workspace = path.join(tmpBase, "config-ts")
    await touch(path.join(workspace, "graphql.config.ts"))
    await touch(path.join(workspace, "query.gql"))

    const result = await LSPServer.GraphQL.root(path.join(workspace, "query.gql"), makeCtx(workspace))
    expect(result).toBe(workspace)
  })

  test("does not start without a graphql config", async () => {
    const workspace = path.join(tmpBase, "no-config")
    await touch(path.join(workspace, "schema.graphql"))

    const result = await LSPServer.GraphQL.root(path.join(workspace, "schema.graphql"), makeCtx(workspace))
    expect(result).toBeUndefined()
  })
})
