import { describe, expect, test } from "bun:test"
import { OpencodeBlobSource, type DocSyncOpts } from "./opencode-doc-source"

function opts(fetch: DocSyncOpts["fetch"]): DocSyncOpts {
  return {
    docID: "doc_1",
    baseUrl: "http://localhost:4096",
    directory: "/tmp/project",
    fetch,
    actorID: "act_1",
    name: "A",
    color: "#000000",
  }
}

describe("OpencodeBlobSource", () => {
  test("uploads blob using the blocksuite source id", async () => {
    const reqs: Array<RequestInfo | URL> = []
    const source = new OpencodeBlobSource(
      opts(async (input, init) => {
        reqs.push(input)
        expect(init?.method).toBe("POST")
        const body = JSON.parse(init?.body as string) as { id: string; mime: string; data: string }
        expect(body.id).toBe("hash")
        expect(body.mime).toBe("image/png")
        expect(body.data).toBe("AQID")
        return new Response(JSON.stringify({ assetID: "hash" }), { status: 200 })
      }),
    )

    await expect(source.set("hash", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }))).resolves.toBe(
      "hash",
    )
    expect(String(reqs[0])).toBe("http://localhost:4096/doc/doc_1/asset?directory=%2Ftmp%2Fproject")
  })

  test("loads stored blob by source id", async () => {
    const source = new OpencodeBlobSource(
      opts(async (input) => {
        expect(String(input)).toBe("http://localhost:4096/doc/doc_1/asset/hash?directory=%2Ftmp%2Fproject")
        return new Response(new Uint8Array([4, 5, 6]), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        })
      }),
    )

    const blob = await source.get("hash")
    expect(blob?.type).toBe("image/png")
    expect(Array.from(new Uint8Array(await blob!.arrayBuffer()))).toEqual([4, 5, 6])
  })
})
