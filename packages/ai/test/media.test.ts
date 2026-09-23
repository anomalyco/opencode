import { describe, expect } from "bun:test"
import { NodeFileSystem } from "@effect/platform-node"
import { Effect, Ref, Schema } from "effect"
import { FileSystem } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { Media, Message } from "../src/index.js"
import { it } from "./lib/effect.js"
import { dynamicResponse, scriptedResponses } from "./lib/http.js"

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])

describe("Media", () => {
  it.effect("round-trips every source through Media.from(asset.source)", () =>
    Effect.sync(() => {
      const assets = [
        Media.bytes(PNG),
        Media.base64("AQID", "image/png"),
        Media.url("https://example.test/a.png", { mediaType: "image/png", expiresAt: 123, headers: { a: "b" } }),
        Media.ref("openai", "file_123", "image/webp"),
      ]
      for (const asset of assets) {
        const copy = Media.from(asset.source)
        expect(copy.source).toEqual(asset.source)
        expect(copy.mediaType).toBe(asset.mediaType)
        expect(copy.kind).toBe(asset.kind)
        expect(copy.expiresAt).toBe(asset.expiresAt)
      }
      expect(assets.map((asset) => asset.kind)).toEqual(["image", "image", "image", "image"])
      expect(Media.url("https://example.test/unknown").mediaType).toBe("application/octet-stream")
      expect(Media.url("https://example.test/unknown").kind).toBe("other")
      expect(Media.base64("AQID", "application/pdf").kind).toBe("document")
      expect(Media.base64("AQID", "video/mp4").kind).toBe("video")
      expect(Media.base64("AQID", "audio/wav").kind).toBe("audio")
    }),
  )

  it.effect("parses data URLs and rejects malformed ones", () =>
    Effect.sync(() => {
      const asset = Media.fromDataUrl("data:image/jpeg;base64,/9j/")
      expect(asset.source).toEqual({ type: "base64", data: "/9j/", mediaType: "image/jpeg" })
      expect(asset.mediaType).toBe("image/jpeg")
      expect(Media.fromDataUrl("data:text/plain;charset=utf-8;base64,aGk=").source).toEqual({
        type: "base64",
        data: "aGk=",
        mediaType: "text/plain",
      })
      expect(() => Media.fromDataUrl("https://example.test/a.png")).toThrow(
        "Media data URLs must contain a MIME type and base64 data",
      )
      expect(() => Media.fromDataUrl("data:image/png,rawtext")).toThrow()
    }),
  )

  it.effect("detects media types from magic bytes", () =>
    Effect.sync(() => {
      expect(Media.detectMediaType(PNG)).toBe("image/png")
      expect(Media.detectMediaType(JPEG)).toBe("image/jpeg")
      expect(Media.detectMediaType(GIF)).toBe("image/gif")
      expect(Media.detectMediaType(WEBP)).toBe("image/webp")
      expect(Media.detectMediaType(PDF)).toBe("application/pdf")
      expect(Media.detectMediaType(Uint8Array.from([1, 2, 3]))).toBeUndefined()
      expect(Media.detectMediaType(new TextEncoder().encode("ID3\x04"))).toBe("audio/mpeg")
      expect(Media.detectMediaType(Uint8Array.from([0xff, 0xfb, 0x90, 0x64]))).toBe("audio/mpeg")
      expect(Media.detectMediaType(Uint8Array.from([0xff, 0xf3, 0x90, 0x64]))).toBe("audio/mpeg")
      expect(Media.detectMediaType(Uint8Array.from([0xff, 0xf1, 0x50, 0x80]))).toBe("audio/aac")
      expect(Media.detectMediaType(new TextEncoder().encode("RIFF\0\0\0\0WAVEfmt "))).toBe("audio/wav")
      expect(Media.detectMediaType(new TextEncoder().encode("OggS\0\x02"))).toBe("audio/ogg")
      expect(Media.detectMediaType(new TextEncoder().encode("fLaC\0\0\0\x22"))).toBe("audio/flac")
      expect(Media.bytes(PNG).mediaType).toBe("image/png")
      expect(Media.bytes(Uint8Array.from([1, 2, 3])).mediaType).toBe("application/octet-stream")
      expect(Media.bytes(Uint8Array.from([1, 2, 3]), "image/x-custom").mediaType).toBe("image/x-custom")
    }),
  )

  it.effect("materializes url assets through the request executor once", () =>
    Effect.gen(function* () {
      const requests = yield* Ref.make<Array<HttpClientRequest.HttpClientRequest>>([])
      const asset = Media.url("https://cdn.example.test/generated", {
        expiresAt: 42,
        headers: { authorization: "Bearer media" },
        providerMetadata: { example: { id: "gen_1" } },
      })
      const program = Effect.gen(function* () {
        const first = yield* asset.bytes()
        const second = yield* asset.bytes()
        expect(second).toBe(first)
        expect(first).toEqual(PNG)
        expect(yield* asset.base64()).toBe(Buffer.from(PNG).toString("base64"))
        expect(yield* asset.dataUrl()).toBe(
          `data:application/octet-stream;base64,${Buffer.from(PNG).toString("base64")}`,
        )

        const owned = yield* asset.materialize()
        expect(owned.source).toEqual({ type: "bytes", data: PNG, mediaType: "image/png" })
        expect(owned.mediaType).toBe("image/png")
        expect(owned.kind).toBe("image")
        expect(owned.expiresAt).toBeUndefined()
        expect(owned.providerMetadata).toEqual({ example: { id: "gen_1" } })
        expect(yield* owned.materialize()).toBe(owned)

        const seen = yield* Ref.get(requests)
        expect(seen).toHaveLength(1)
        expect(seen[0].url).toBe("https://cdn.example.test/generated")
        expect(seen[0].headers.authorization).toBe("Bearer media")
      })
      yield* program.pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Ref.update(requests, (all) => [...all, input.request]).pipe(
              Effect.map(() => input.respond(PNG, { headers: { "content-type": "image/png" } })),
            ),
          ),
        ),
      )
    }),
  )

  it.effect("caches decoded base64 bytes and encodes owned bytes lazily", () =>
    Effect.gen(function* () {
      const fromBase64 = Media.base64("AQID", "image/png")
      const decoded = yield* fromBase64.bytes()
      expect(decoded).toEqual(Uint8Array.from([1, 2, 3]))
      expect(yield* fromBase64.bytes()).toBe(decoded)
      expect(yield* fromBase64.base64()).toBe("AQID")

      const fromBytes = Media.bytes(Uint8Array.from([1, 2, 3]), "image/png")
      const encoded = yield* fromBytes.base64()
      expect(encoded).toBe("AQID")
      expect(yield* fromBytes.base64()).toBe(encoded)
      expect(yield* fromBytes.dataUrl()).toBe("data:image/png;base64,AQID")

      const invalid = yield* Media.base64("not base64!", "image/png").bytes().pipe(Effect.flip)
      expect(invalid.reason._tag).toBe("InvalidRequest")
      const ref = yield* Media.ref("openai", "file_1").bytes().pipe(Effect.flip)
      expect(ref.reason._tag).toBe("InvalidRequest")
    }).pipe(Effect.provide(scriptedResponses(["unused"]))),
  )

  it.effect("serializes assets inside messages and restores them as Media.Asset", () =>
    Effect.sync(() => {
      const codec = Schema.fromJsonString(Message)
      const message = Message.user([
        Message.media(Media.base64("AQID", "image/png", { info: { width: 1, height: 1 } }), { filename: "a.png" }),
        Message.media(Media.url("https://example.test/b.pdf", { mediaType: "application/pdf", expiresAt: 7 })),
      ])
      const json = Schema.encodeSync(codec)(message)
      expect(json).not.toContain("null")
      const restored = Schema.decodeSync(codec)(json)
      const parts = restored.content.filter((part) => part.type === "media")
      expect(parts).toHaveLength(2)
      expect(parts[0].media).toBeInstanceOf(Media.Asset)
      expect(parts[0].media.source).toEqual({ type: "base64", data: "AQID", mediaType: "image/png" })
      expect(parts[0].media.info).toEqual({ width: 1, height: 1 })
      expect(parts[0].filename).toBe("a.png")
      expect(parts[1].media.kind).toBe("document")
      expect(parts[1].media.expiresAt).toBe(7)
    }),
  )

  it.effect("reads files with sniffed media types and writes materialized assets", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const dir = yield* fs.makeTempDirectoryScoped()
      const source = `${dir}/source.bin`
      yield* fs.writeFile(source, PNG)

      const asset = yield* Media.file(source)
      expect(asset.mediaType).toBe("image/png")
      expect(asset.source).toEqual({ type: "bytes", data: PNG, mediaType: "image/png" })

      const plain = `${dir}/notes.md`
      yield* fs.writeFile(plain, new TextEncoder().encode("# hi"))
      expect((yield* Media.file(plain)).mediaType).toBe("text/markdown")

      const target = `${dir}/copy.png`
      yield* Media.write(Media.base64("AQID", "image/png"), target)
      expect(yield* fs.readFile(target)).toEqual(Uint8Array.from([1, 2, 3]))

      const missing = yield* Media.file(`${dir}/missing.png`).pipe(Effect.flip)
      expect(missing.reason._tag).toBe("InvalidRequest")
    }).pipe(Effect.provide(NodeFileSystem.layer), Effect.provide(scriptedResponses(["unused"]))),
  )
})
