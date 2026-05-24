// [fork-only] file-uploader 单测
// [feat: feishu-bridge-light] 2026-05-23

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  isRecoverableError,
  MAX_FILE_BYTES,
  MAX_IMAGE_BYTES,
  retryUpload,
  sendFileMessage,
  sendImageMessage,
  uploadFile,
  uploadImage,
  withTimeout,
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
  /** [feishu-attach-upload-robustness] 多次调用行为:每次调用按 index 取 errors[index],undefined 表示成功 */
  imageErrorsPerCall?: ReadonlyArray<Error | undefined>
  fileErrorsPerCall?: ReadonlyArray<Error | undefined>
} = {}) {
  const imageCalls: ImageCreateCall[] = []
  const fileCalls: FileCreateCall[] = []
  const messageCalls: MessageCreateCall[] = []
  let imageCallIdx = 0
  let fileCallIdx = 0

  const client = {
    im: {
      v1: {
        image: {
          create: async (args: any) => {
            // 多次调用 sequence error 优先
            if (opts.imageErrorsPerCall) {
              const err = opts.imageErrorsPerCall[imageCallIdx]
              imageCallIdx++
              if (err) throw err
            } else if (opts.imageError) {
              throw opts.imageError
            }
            imageCalls.push({ image_type: args.data.image_type })
            // 默认返 image_key,显式 null 时返 null(测错误路径)
            if (opts.imageKey === null) return null
            return { image_key: opts.imageKey ?? "img_key_fake" }
          },
        },
        file: {
          create: async (args: any) => {
            if (opts.fileErrorsPerCall) {
              const err = opts.fileErrorsPerCall[fileCallIdx]
              fileCallIdx++
              if (err) throw err
            } else if (opts.fileError) {
              throw opts.fileError
            }
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

/** Fast retry options 用 10ms 退避而非 prod 1s/3s,让单测不慢 */
const FAST_RETRY = { delaysMs: [10, 10] as const, timeoutMs: 5000 }

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

  test("SDK 抛 non-recoverable → 透传不重试", async () => {
    // 改用 401(不在 RECOVERABLE_ERROR_PATTERNS),避免 retry 3 次拖慢测试
    // [feat: feishu-attach-upload-robustness] 2026-05-24
    const p = makeFile("a.png", 100)
    const { client } = makeFakeClient({ imageError: new Error("401 Unauthorized") })
    await expect(uploadImage(client, p)).rejects.toThrow(/401 Unauthorized/)
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

// ============================================================
// [feat: feishu-attach-upload-robustness] 2026-05-24
// retry / timeout / recoverable error 检测
// ============================================================

describe("isRecoverableError", () => {
  test("socket closed → true", () => {
    expect(isRecoverableError(new Error("The socket connection was closed unexpectedly"))).toBe(true)
  })

  test("ECONNRESET → true", () => {
    expect(isRecoverableError(new Error("ECONNRESET"))).toBe(true)
  })

  test("EPIPE → true", () => {
    expect(isRecoverableError(new Error("write EPIPE"))).toBe(true)
  })

  test("network error → true", () => {
    expect(isRecoverableError(new Error("network error occurred"))).toBe(true)
  })

  test("timeout → true", () => {
    expect(isRecoverableError(new Error("upload timeout after 30000ms"))).toBe(true)
  })

  test("502 5xx status → true", () => {
    expect(isRecoverableError(new Error("server returned 502 Bad Gateway"))).toBe(true)
  })

  test("503 → true", () => {
    expect(isRecoverableError(new Error("Service Unavailable 503"))).toBe(true)
  })

  test("400 → false(业务错误不重试)", () => {
    expect(isRecoverableError(new Error("400 Bad Request"))).toBe(false)
  })

  test("401 unauthorized → false", () => {
    expect(isRecoverableError(new Error("401 Unauthorized"))).toBe(false)
  })

  test("size 超过限制 → false", () => {
    expect(isRecoverableError(new Error("image foo.png 50MB 超过 10MB 限制"))).toBe(false)
  })

  test("空 → false", () => {
    expect(isRecoverableError("")).toBe(false)
  })

  test("undefined → false", () => {
    expect(isRecoverableError(undefined)).toBe(false)
  })
})

describe("withTimeout", () => {
  test("Promise 在 timeout 之前 resolve → 返原结果", async () => {
    const fast = new Promise<string>((r) => setTimeout(() => r("ok"), 10))
    const result = await withTimeout(fast, 1000, "test")
    expect(result).toBe("ok")
  })

  test("Promise 超 timeout → reject with label", async () => {
    const slow = new Promise<string>((r) => setTimeout(() => r("ok"), 1000))
    await expect(withTimeout(slow, 50, "slow-task")).rejects.toThrow(/slow-task timeout after 50ms/)
  })

  test("Promise 在 timeout 之前 reject → 透传错误", async () => {
    const broken = Promise.reject(new Error("original"))
    await expect(withTimeout(broken, 1000, "test")).rejects.toThrow(/original/)
  })
})

describe("retryUpload", () => {
  test("成功一次 → 1 次调用,立即返", async () => {
    let count = 0
    const fn = async () => {
      count++
      return "ok"
    }
    const result = await retryUpload(fn, "test", FAST_RETRY)
    expect(result).toBe("ok")
    expect(count).toBe(1)
  })

  test("可恢复错 1 次后成功 → 2 次调用", async () => {
    let count = 0
    const fn = async () => {
      count++
      if (count === 1) throw new Error("socket connection closed unexpectedly")
      return "ok"
    }
    const result = await retryUpload(fn, "test", FAST_RETRY)
    expect(result).toBe("ok")
    expect(count).toBe(2)
  })

  test("可恢复错 2 次后成功 → 3 次调用(最后一次)", async () => {
    let count = 0
    const fn = async () => {
      count++
      if (count <= 2) throw new Error("ECONNRESET")
      return "ok"
    }
    const result = await retryUpload(fn, "test", FAST_RETRY)
    expect(result).toBe("ok")
    expect(count).toBe(3)
  })

  test("3 次都失败 → throw 最后错,3 次调用", async () => {
    let count = 0
    const fn = async () => {
      count++
      throw new Error("socket closed")
    }
    await expect(retryUpload(fn, "test", FAST_RETRY)).rejects.toThrow(/socket closed/)
    expect(count).toBe(3) // 1 初次 + 2 retry
  })

  test("非可恢复错 → 1 次后立即 throw,不 retry", async () => {
    let count = 0
    const fn = async () => {
      count++
      throw new Error("400 Bad Request")
    }
    await expect(retryUpload(fn, "test", FAST_RETRY)).rejects.toThrow(/400 Bad Request/)
    expect(count).toBe(1)
  })

  test("timeout 触发 → 视为可恢复 retry", async () => {
    let count = 0
    const fn = async () => {
      count++
      // 第一次永久卡住(让 timeout 触发);第二次正常返
      if (count === 1) {
        return new Promise<string>(() => {}) // 永不 resolve
      }
      return "ok"
    }
    const result = await retryUpload(fn, "test", { delaysMs: [10] as const, timeoutMs: 30 })
    expect(result).toBe("ok")
    expect(count).toBe(2)
  })
})

describe("uploadImage with retry (集成)", () => {
  test("socket 失败 1 次后成功 → 返 key,2 次 SDK 调用", async () => {
    const p = makeFile("a.png", 100)
    const { client, imageCalls } = makeFakeClient({
      imageErrorsPerCall: [new Error("socket connection closed unexpectedly"), undefined],
    })
    const key = await uploadImage(client, p, FAST_RETRY)
    expect(key).toBe("img_key_fake")
    expect(imageCalls).toHaveLength(1) // 第 1 次 throw 不计 push,第 2 次成功 push
  })

  test("3 次 socket 失败 → throw,3 次 SDK 调用", async () => {
    const p = makeFile("a.png", 100)
    const err = new Error("socket connection closed unexpectedly")
    const { client, imageCalls } = makeFakeClient({
      imageErrorsPerCall: [err, err, err],
    })
    await expect(uploadImage(client, p, FAST_RETRY)).rejects.toThrow(/socket connection closed/)
    expect(imageCalls).toHaveLength(0) // 3 次都 throw,push 都没执行
  })

  test("size 超限 → 0 次 SDK 调用(预检拦截,不进 retry)", async () => {
    const p = makeFile("big.png", MAX_IMAGE_BYTES + 1)
    const { client, imageCalls } = makeFakeClient()
    await expect(uploadImage(client, p, FAST_RETRY)).rejects.toThrow(/超过/)
    expect(imageCalls).toHaveLength(0)
  })

  test("非可恢复(401)→ 1 次调用立即失败", async () => {
    const p = makeFile("a.png", 100)
    const { client, imageCalls } = makeFakeClient({
      imageErrorsPerCall: [new Error("401 Unauthorized")],
    })
    await expect(uploadImage(client, p, FAST_RETRY)).rejects.toThrow(/401/)
    expect(imageCalls).toHaveLength(0)
  })
})

describe("uploadFile with retry (集成)", () => {
  test("socket 失败 1 次后成功 → 返 key,2 次 SDK 调用", async () => {
    const p = makeFile("a.pdf", 100)
    const { client, fileCalls } = makeFakeClient({
      fileErrorsPerCall: [new Error("socket closed"), undefined],
    })
    const key = await uploadFile(client, p, "pdf", FAST_RETRY)
    expect(key).toBe("file_key_fake")
    expect(fileCalls).toHaveLength(1)
  })

  test("3 次 socket 失败 → throw", async () => {
    const p = makeFile("a.pdf", 100)
    const err = new Error("socket closed")
    const { client } = makeFakeClient({
      fileErrorsPerCall: [err, err, err],
    })
    await expect(uploadFile(client, p, "pdf", FAST_RETRY)).rejects.toThrow(/socket closed/)
  })
})
