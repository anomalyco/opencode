// [fork-only] file-uploader 单测
// [feat: feishu-bridge-light] 2026-05-23

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  MAX_FILE_BYTES,
  MAX_IMAGE_BYTES,
  sendFileMessage,
  sendImageMessage,
  uploadFile,
  uploadImage,
} from "../file-uploader"

interface ImageCreateCall {
  image_type: string
}
interface FileCreateCall {
  file_type: string
  file_name: string
}
interface MessageCreateCall {
  receive_id: string
  msg_type: string
  content: string
}

function makeFakeClient(opts: {
  imageKey?: string | null
  fileKey?: string | null
  imageError?: Error
  fileError?: Error
} = {}) {
  const imageCalls: ImageCreateCall[] = []
  const fileCalls: FileCreateCall[] = []
  const messageCalls: MessageCreateCall[] = []

  const client = {
    im: {
      v1: {
        image: {
          create: async (args: any) => {
            if (opts.imageError) throw opts.imageError
            imageCalls.push({ image_type: args.data.image_type })
            // 默认返 image_key,显式 null 时返 null(测错误路径)
            if (opts.imageKey === null) return null
            return { image_key: opts.imageKey ?? "img_key_fake" }
          },
        },
        file: {
          create: async (args: any) => {
            if (opts.fileError) throw opts.fileError
            fileCalls.push({ file_type: args.data.file_type, file_name: args.data.file_name })
            if (opts.fileKey === null) return null
            return { file_key: opts.fileKey ?? "file_key_fake" }
          },
        },
        message: {
          create: async (args: any) => {
            messageCalls.push({
              receive_id: args.data.receive_id,
              msg_type: args.data.msg_type,
              content: args.data.content,
            })
            return { data: { message_id: "om_fake" } }
          },
        },
      },
    },
  } as any

  return { client, imageCalls, fileCalls, messageCalls }
}

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "file-uploader-test-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function makeFile(name: string, size: number): string {
  const p = join(tmpDir, name)
  writeFileSync(p, Buffer.alloc(size))
  return p
}

describe("uploadImage", () => {
  test("小于 10MB 正常上传 → 返回 image_key", async () => {
    const p = makeFile("a.png", 1024)
    const { client, imageCalls } = makeFakeClient({ imageKey: "img_TEST_1" })
    const key = await uploadImage(client, p)
    expect(key).toBe("img_TEST_1")
    expect(imageCalls).toHaveLength(1)
    expect(imageCalls[0]!.image_type).toBe("message")
  })

  test("超 10MB → 抛 size 错(预检拦截,不调 SDK)", async () => {
    const p = makeFile("big.png", MAX_IMAGE_BYTES + 1)
    const { client, imageCalls } = makeFakeClient()
    await expect(uploadImage(client, p)).rejects.toThrow(/超过/)
    expect(imageCalls).toHaveLength(0)
  })

  test("SDK 返 null → 抛", async () => {
    const p = makeFile("a.png", 100)
    const { client } = makeFakeClient({ imageKey: null })
    await expect(uploadImage(client, p)).rejects.toThrow(/未返回 image_key/)
  })

  test("SDK 抛 → 透传", async () => {
    const p = makeFile("a.png", 100)
    const { client } = makeFakeClient({ imageError: new Error("lark 502") })
    await expect(uploadImage(client, p)).rejects.toThrow(/lark 502/)
  })
})

describe("uploadFile", () => {
  test("小于 30MB 正常上传 → 返回 file_key + 带 file_name basename", async () => {
    const p = makeFile("report.pdf", 1024)
    const { client, fileCalls } = makeFakeClient({ fileKey: "file_TEST_1" })
    const key = await uploadFile(client, p, "pdf")
    expect(key).toBe("file_TEST_1")
    expect(fileCalls).toHaveLength(1)
    expect(fileCalls[0]).toEqual({ file_type: "pdf", file_name: "report.pdf" })
  })

  test("stream fileType 也工作(兜底)", async () => {
    const p = makeFile("a.docx", 100)
    const { client, fileCalls } = makeFakeClient()
    await uploadFile(client, p, "stream")
    expect(fileCalls[0]!.file_type).toBe("stream")
  })

  test("超 30MB → 抛 size 错", async () => {
    const p = makeFile("big.mp4", MAX_FILE_BYTES + 1)
    const { client, fileCalls } = makeFakeClient()
    await expect(uploadFile(client, p, "mp4")).rejects.toThrow(/超过/)
    expect(fileCalls).toHaveLength(0)
  })

  test("SDK 返 null → 抛", async () => {
    const p = makeFile("a.pdf", 100)
    const { client } = makeFakeClient({ fileKey: null })
    await expect(uploadFile(client, p, "pdf")).rejects.toThrow(/未返回 file_key/)
  })
})

describe("sendImageMessage / sendFileMessage", () => {
  test("sendImageMessage:msg_type=image + content image_key JSON", async () => {
    const { client, messageCalls } = makeFakeClient()
    await sendImageMessage(client, "oc_chat_x", "img_KEY_1")
    expect(messageCalls).toHaveLength(1)
    expect(messageCalls[0]!.receive_id).toBe("oc_chat_x")
    expect(messageCalls[0]!.msg_type).toBe("image")
    expect(JSON.parse(messageCalls[0]!.content)).toEqual({ image_key: "img_KEY_1" })
  })

  test("sendFileMessage:msg_type=file + content file_key JSON", async () => {
    const { client, messageCalls } = makeFakeClient()
    await sendFileMessage(client, "oc_chat_y", "file_KEY_1")
    expect(messageCalls).toHaveLength(1)
    expect(messageCalls[0]!.msg_type).toBe("file")
    expect(JSON.parse(messageCalls[0]!.content)).toEqual({ file_key: "file_KEY_1" })
  })
})
