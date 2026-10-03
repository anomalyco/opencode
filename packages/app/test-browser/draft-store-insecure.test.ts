import { afterEach, describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createBlobReference } from "@/utils/draft-store"
import { createPromptAttachmentsCore } from "@/components/prompt-input/attachments"
import { createPromptState } from "@/context/prompt"

const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto")

const realCrypto = globalThis.crypto

const setCrypto = (value: unknown) => {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: value as Crypto,
  })
}

afterEach(() => {
  if (cryptoDescriptor) {
    Object.defineProperty(globalThis, "crypto", cryptoDescriptor)
  }
})

const ensureObjectURL = () => {
  if (typeof URL.createObjectURL !== "function") {
    URL.createObjectURL = () => `blob:mock-${Math.random().toString(16).slice(2)}`
  }
}

describe("blob reference insecure contexts", () => {
  test("uses SHA-256 when subtle is available", async () => {
    ensureObjectURL()
    setCrypto(realCrypto)
    const bytes = new Uint8Array([1, 2, 3, 4])
    const first = await createBlobReference(new File([bytes], "a.png", { type: "image/png" }))
    const second = await createBlobReference(new File([bytes], "a.png", { type: "image/png" }))
    expect(first.id).toBe(second.id)
    expect(first.id).toMatch(/^[0-9a-f]{64}$/)
  })

  test("falls back when subtle is missing", async () => {
    ensureObjectURL()
    setCrypto({ getRandomValues: realCrypto.getRandomValues.bind(realCrypto), subtle: undefined })
    const ref = await createBlobReference(new File([new Uint8Array([9, 9, 9])], "b.png", { type: "image/png" }))
    expect(ref.id).toMatch(/^[0-9a-f]{64}$/)
    expect(ref.url.startsWith("blob:")).toBe(true)
  })

  test("falls back when subtle.digest throws", async () => {
    ensureObjectURL()
    setCrypto({
      getRandomValues: realCrypto.getRandomValues.bind(realCrypto),
      subtle: {
        digest: () => Promise.reject(new Error("denied")),
      },
    })
    const ref = await createBlobReference(new File([new Uint8Array([7])], "c.png", { type: "image/png" }))
    expect(ref.id).toMatch(/^[0-9a-f]{64}$/)
  })

  test("attaches an image on insecure contexts without a draft store", async () => {
    ensureObjectURL()
    setCrypto({ getRandomValues: realCrypto.getRandomValues.bind(realCrypto), subtle: undefined })
    await createRoot(async (dispose) => {
      const prompt = createPromptState()
      const attachments = createPromptAttachmentsCore({
        capture: prompt.capture,
        editor: () => document.createElement("div"),
      })
      const ok = await attachments.addAttachment(new File([new Uint8Array(1024)], "photo.png", { type: "image/png" }))
      expect(ok).toBe(true)
      expect(prompt.current().filter((part) => part.type === "image")).toHaveLength(1)
      dispose()
    })
  })

  test("attaches an empty image and rejects a binary non-image", async () => {
    ensureObjectURL()
    setCrypto(realCrypto)
    await createRoot(async (dispose) => {
      const prompt = createPromptState()
      let warned = 0
      const attachments = createPromptAttachmentsCore({
        capture: prompt.capture,
        editor: () => document.createElement("div"),
        warn: () => {
          warned += 1
        },
      })
      const empty = await attachments.addAttachment(new File([], "empty.png", { type: "image/png" }))
      expect(empty).toBe(true)
      const binary = new File([new Uint8Array([0, 1, 2, 3, 255, 0, 9])], "tool.exe", { type: "" })
      const rejected = await attachments.addAttachment(binary)
      expect(rejected).toBe(false)
      expect(warned).toBe(1)
      dispose()
    })
  })
})
