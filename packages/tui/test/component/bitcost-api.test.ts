import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import { createBitcostTask, fetchBitcostTasks, updateBitcostTask, completeBitcostTask } from "../../src/component/bitcost-api"

describe("bitcost-api task normalization", () => {
  test("normalizes camelCase task fields from the list response", async () => {
    const originalFetch = globalThis.fetch
    const originalEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = undefined
    globalThis.fetch = Object.assign(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: 1,
                name: "Task",
                costTotal: 12.5,
                usageCount: 4,
                externalUrl: "https://example.com/task/1",
                createdAt: "2026-01-01T00:00:00Z",
                completedAt: "2026-01-02T00:00:00Z",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      { preconnect: originalFetch.preconnect },
    ) as typeof fetch

    const originalRead = fs.readFileSync
    fs.readFileSync = ((path: fs.PathOrFileDescriptor, options?: Parameters<typeof fs.readFileSync>[1]) => {
      if (String(path).includes("bitcost-auth.json")) {
        return JSON.stringify({ access_token: "token" })
      }
      return originalRead(path, options as never)
    }) as typeof fs.readFileSync

    try {
      await expect(fetchBitcostTasks()).resolves.toEqual([
        expect.objectContaining({
          cost_total: 12.5,
          usage_count: 4,
          external_url: "https://example.com/task/1",
          created_at: "2026-01-01T00:00:00Z",
          completed_at: "2026-01-02T00:00:00Z",
        }),
      ])
    } finally {
      globalThis.fetch = originalFetch
      fs.readFileSync = originalRead
      if (originalEnv === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalEnv
    }
  })

  test("normalizes camelCase task fields from create response", async () => {
    const originalFetch = globalThis.fetch
    const originalEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = undefined
    globalThis.fetch = Object.assign(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              id: 2,
              name: "Created",
              costTotal: 1.5,
              usageCount: 1,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      { preconnect: originalFetch.preconnect },
    ) as typeof fetch

    const originalRead = fs.readFileSync
    fs.readFileSync = ((path: fs.PathOrFileDescriptor, options?: Parameters<typeof fs.readFileSync>[1]) => {
      if (String(path).includes("bitcost-auth.json")) {
        return JSON.stringify({ access_token: "token" })
      }
      return originalRead(path, options as never)
    }) as typeof fs.readFileSync

    try {
      await expect(createBitcostTask("Created")).resolves.toEqual(
        expect.objectContaining({
          cost_total: 1.5,
          usage_count: 1,
        }),
      )
    } finally {
      globalThis.fetch = originalFetch
      fs.readFileSync = originalRead
      if (originalEnv === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalEnv
    }
  })
})

test("normalizes camelCase task fields from update response", async () => {
  const originalFetch = globalThis.fetch
  const originalEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = undefined
  globalThis.fetch = Object.assign(
    async () =>
      new Response(
        JSON.stringify({
          data: {
            id: 3,
            name: "Updated",
            costTotal: 2.5,
            usageCount: 2,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    { preconnect: originalFetch.preconnect },
  ) as typeof fetch

  const originalRead = fs.readFileSync
  fs.readFileSync = ((path: fs.PathOrFileDescriptor, options?: Parameters<typeof fs.readFileSync>[1]) => {
    if (String(path).includes("bitcost-auth.json")) {
      return JSON.stringify({ access_token: "token" })
    }
    return originalRead(path, options as never)
  }) as typeof fs.readFileSync

  try {
    await expect(updateBitcostTask(3, "Updated")).resolves.toEqual(
      expect.objectContaining({
        cost_total: 2.5,
        usage_count: 2,
      }),
    )
  } finally {
    globalThis.fetch = originalFetch
    fs.readFileSync = originalRead
    if (originalEnv === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalEnv
  }
})

test("normalizes camelCase task fields from complete response", async () => {
  const originalFetch = globalThis.fetch
  const originalEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = undefined
  globalThis.fetch = Object.assign(
    async () =>
      new Response(
        JSON.stringify({
          data: {
            id: 3,
            name: "Completed",
            costTotal: 2.5,
            usageCount: 2,
            completedAt: "2026-01-02T00:00:00Z",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    { preconnect: originalFetch.preconnect },
  ) as typeof fetch

  const originalRead = fs.readFileSync
  fs.readFileSync = ((path: fs.PathOrFileDescriptor, options?: Parameters<typeof fs.readFileSync>[1]) => {
    if (String(path).includes("bitcost-auth.json")) {
      return JSON.stringify({ access_token: "token" })
    }
    return originalRead(path, options as never)
  }) as typeof fs.readFileSync

  try {
    await expect(completeBitcostTask(3)).resolves.toEqual(
      expect.objectContaining({
        cost_total: 2.5,
        usage_count: 2,
        completed_at: "2026-01-02T00:00:00Z",
      }),
    )
  } finally {
    globalThis.fetch = originalFetch
    fs.readFileSync = originalRead
    if (originalEnv === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalEnv
  }
})
