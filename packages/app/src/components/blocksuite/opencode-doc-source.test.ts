import { describe, expect, test } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { MSG_DOC, pack } from "./doc-sync-protocol"
import { OpencodeBlobSource, OpencodeDocSource, type DocSyncOpts } from "./opencode-doc-source"

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function href(input: RequestInfo | URL) {
  return input instanceof Request ? input.url : String(input)
}

function opts(fetch: Fetch, baseUrl = "http://localhost:4096"): DocSyncOpts {
  return {
    docID: "doc_1",
    baseUrl,
    directory: "/tmp/project",
    client: createOpencodeClient({
      baseUrl,
      directory: "/tmp/project",
      fetch: fetch as unknown as typeof globalThis.fetch,
      throwOnError: true,
    }),
    actorID: "act_1",
    name: "A",
    color: "#000000",
  }
}

function prefixed(fetch: Fetch): DocSyncOpts {
  return opts(fetch, "https://opencode.dev.jitda.io/user/heu56ribam8opgty")
}

describe("OpencodeBlobSource", () => {
  test("uploads blob using the blocksuite source id", async () => {
    const reqs: Array<RequestInfo | URL> = []
    const source = new OpencodeBlobSource(
      opts(async (input) => {
        reqs.push(input)
        if (!(input instanceof Request)) throw new Error("expected request")
        expect(input.method).toBe("POST")
        const body = (await input.json()) as { id: string; mime: string; data: string }
        expect(body.id).toBe("hash")
        expect(body.mime).toBe("image/png")
        expect(body.data).toBe("AQID")
        return new Response(JSON.stringify({ assetID: "hash" }), { status: 200 })
      }),
    )

    await expect(source.set("hash", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }))).resolves.toBe(
      "hash",
    )
    expect(href(reqs[0]!)).toBe("http://localhost:4096/doc/doc_1/asset?directory=%2Ftmp%2Fproject")
  })

  test("loads stored blob by source id", async () => {
    const source = new OpencodeBlobSource(
      opts(async (input) => {
        expect(href(input)).toBe("http://localhost:4096/doc/doc_1/asset/hash?directory=%2Ftmp%2Fproject")
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

  test("preserves reverse proxy base path", async () => {
    const source = new OpencodeBlobSource(
      prefixed(async (input) => {
        expect(href(input)).toBe(
          "https://opencode.dev.jitda.io/user/heu56ribam8opgty/doc/doc_1/asset/hash?directory=%2Ftmp%2Fproject",
        )
        return new Response(new Uint8Array([1]), { status: 200 })
      }),
    )

    await expect(source.get("hash")).resolves.toBeInstanceOf(Blob)
  })
})

describe("OpencodeDocSource", () => {
  test("subscribes over websocket without polling sync", async () => {
    const prev = globalThis.WebSocket
    const reqs: Array<RequestInfo | URL> = []
    const seen: Array<{ id: string; data: number[] }> = []

    class Sock extends EventTarget {
      static CONNECTING = 0
      static OPEN = 1
      static CLOSING = 2
      static CLOSED = 3
      static all: Sock[] = []
      binaryType: BinaryType = "blob"
      readyState = Sock.CONNECTING
      url: string

      constructor(url: string | URL) {
        super()
        this.url = String(url)
        Sock.all.push(this)
      }

      send(_data: string | ArrayBufferLike | Blob | ArrayBufferView) {}

      close() {
        this.readyState = Sock.CLOSED
        this.dispatchEvent(new CloseEvent("close"))
      }

      open() {
        this.readyState = Sock.OPEN
        this.dispatchEvent(new Event("open"))
      }

      message(data: Uint8Array) {
        this.dispatchEvent(new MessageEvent("message", { data: data.buffer.slice(0) }))
      }
    }

    globalThis.WebSocket = Sock as unknown as typeof WebSocket

    const source = new OpencodeDocSource(
      opts(async (input) => {
        reqs.push(input)
        return new Response(JSON.stringify(null), { status: 200 })
      }),
    )

    const stop = source.subscribe((id, data) => seen.push({ id, data: [...data] }), () => undefined)
    const sock = Sock.all[0]!
    expect(sock.url).toBe("ws://localhost:4096/doc/doc_1/connect?directory=%2Ftmp%2Fproject&kind=doc")
    sock.open()
    const dispose = await stop

    sock.message(pack(MSG_DOC, "page", new Uint8Array([1, 2, 3])))
    expect(seen).toEqual([{ id: "page", data: [1, 2, 3] }])
    expect(reqs).toHaveLength(0)

    dispose()
    globalThis.WebSocket = prev
  })
})
