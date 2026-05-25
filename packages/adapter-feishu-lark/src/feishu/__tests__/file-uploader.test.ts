// [fork-only] file-uploader 单测
// [feat: feishu-bridge-light] 2026-05-23
// [feat: feishu-attach-upload-robustness iter 4] 2026-05-24 — 测试切换 SDK mock → fetch mock

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  isRecoverableError,
  MAX_FILE_BYTES,
  MAX_IMAGE_BYTES,
  retryUpload,
  sanitizeFileNameForUpload,
  sendFileMessage,
  sendImageMessage,
  uploadFile,
  uploadImage,
  withTimeout,
} from "../file-uploader"

interface UploadCall {
  /** 命中的 endpoint URL */
  endpoint: string
  /** multipart 字段值(string) */
  fields: Record<string, string>
  /** file/image 字段的 filename(从 Blob 元数据取) */
  fileName: string
  /** file/image 字段的字节数 */
  fileSize: number
}
interface MessageCreateCall {
  receive_id: string
  msg_type: string
  content: string
}

/**
 * fakeClient 跟 fetch mock 联合 setup。
 *
 * iter 4 起,uploadImage / uploadFile 不再走 SDK 的 image.create / file.create,
 * 而是直接 Bun-native `fetch(POST /open-apis/im/v1/{images,files})` + FormData + Blob。
 * 因此测试需要:
 *   - fakeClient 提供 `tokenManager.getTenantAccessToken` + `domain`(给 iter 4 的
 *     `getClientAuthContext` 读)
 *   - 拦截 globalThis.fetch,按 URL 分流 image / file,按 sequence error 配置抛错
 *
 * 仍保留 `client.im.v1.message.create` mock — sendImageMessage / sendFileMessage 还走 SDK。
 */
function makeFakeClient(opts: {
  imageKey?: string | null
  fileKey?: string | null
  imageError?: Error
  fileError?: Error
  /** 多次调用行为:每次按 index 取,undefined 表示成功 */
  imageErrorsPerCall?: ReadonlyArray<Error | undefined>
  fileErrorsPerCall?: ReadonlyArray<Error | undefined>
} = {}) {
  const imageCalls: UploadCall[] = []
  const fileCalls: UploadCall[] = []
  const messageCalls: MessageCreateCall[] = []
  let imageCallIdx = 0
  let fileCallIdx = 0

  const client = {
    domain: "https://open.feishu.cn",
    tokenManager: {
      getTenantAccessToken: async (_opts: object): Promise<string> => "fake_tenant_token_xyz",
    },
    im: {
      v1: {
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

  // fetch mock:install via beforeEach; cleanup via afterEach
  const originalFetch = globalThis.fetch
  const installFetchMock = () => {
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input?.url ?? String(input)
      const isImage = url.includes("/open-apis/im/v1/images")
      const isFile = url.includes("/open-apis/im/v1/files")
      if (!isImage && !isFile) {
        throw new Error(`fakeClient: unexpected fetch URL ${url}`)
      }

      // 提 FormData 内容(Bun-native FormData,直接 entries)
      const form = init?.body as FormData | undefined
      const fields: Record<string, string> = {}
      let fileName = ""
      let fileSize = 0
      if (form && typeof form.entries === "function") {
        for (const [k, v] of form.entries()) {
          // FormData.entries 返 [string, FormDataEntryValue] — File / string;TS lib 缺 Blob 分支判断,用 duck type
          if (typeof v === "object" && v !== null && "size" in v) {
            const blob = v as Blob & { name?: string }
            fileSize = blob.size
            // Bun 把 FormData 第三参 filename attach 到 File 子类的 name
            fileName = blob.name ?? ""
          } else {
            fields[k] = String(v)
          }
        }
      }

      // 触发对应路径的 sequence error / 单次 error
      if (isImage) {
        if (opts.imageErrorsPerCall) {
          const err = opts.imageErrorsPerCall[imageCallIdx]
          imageCallIdx++
          if (err) throw err
        } else if (opts.imageError) {
          throw opts.imageError
        }
        imageCalls.push({ endpoint: url, fields, fileName, fileSize })
        const body =
          opts.imageKey === null
            ? { code: 0, msg: "ok", data: {} }
            : { code: 0, msg: "ok", data: { image_key: opts.imageKey ?? "img_key_fake" } }
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      } else {
        if (opts.fileErrorsPerCall) {
          const err = opts.fileErrorsPerCall[fileCallIdx]
          fileCallIdx++
          if (err) throw err
        } else if (opts.fileError) {
          throw opts.fileError
        }
        fileCalls.push({ endpoint: url, fields, fileName, fileSize })
        const body =
          opts.fileKey === null
            ? { code: 0, msg: "ok", data: {} }
            : { code: 0, msg: "ok", data: { file_key: opts.fileKey ?? "file_key_fake" } }
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
    }) as unknown as typeof fetch
  }
  const uninstallFetchMock = () => {
    globalThis.fetch = originalFetch
  }

  return { client, imageCalls, fileCalls, messageCalls, installFetchMock, uninstallFetchMock }
}

/** Fast retry options 用 10ms 退避而非 prod 1s/3s,让单测不慢 */
const FAST_RETRY = { delaysMs: [10, 10] as const, timeoutMs: 5000 }

let tmpDir: string
/** 当前 active mock client — afterEach 用来 uninstall fetch 钩子 */
let activeMockClient: ReturnType<typeof makeFakeClient> | null = null

/** makeFakeClient 包装:自动 install fetch mock + 注册 cleanup */
function makeMock(opts?: Parameters<typeof makeFakeClient>[0]) {
  const m = makeFakeClient(opts)
  m.installFetchMock()
  activeMockClient = m
  return m
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "file-uploader-test-"))
})

afterEach(() => {
  if (activeMockClient) {
    activeMockClient.uninstallFetchMock()
    activeMockClient = null
  }
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
    const { client, imageCalls } = makeMock({ imageKey: "img_TEST_1" })
    const key = await uploadImage(client, p)
    expect(key).toBe("img_TEST_1")
    expect(imageCalls).toHaveLength(1)
    expect(imageCalls[0]!.fields.image_type).toBe("message")
  })

  test("超 10MB → 抛 size 错(预检拦截,不调 SDK)", async () => {
    const p = makeFile("big.png", MAX_IMAGE_BYTES + 1)
    const { client, imageCalls } = makeMock()
    await expect(uploadImage(client, p)).rejects.toThrow(/超过/)
    expect(imageCalls).toHaveLength(0)
  })

  test("SDK 返 null → 抛", async () => {
    const p = makeFile("a.png", 100)
    const { client } = makeMock({ imageKey: null })
    await expect(uploadImage(client, p)).rejects.toThrow(/未返回 image_key/)
  })

  test("SDK 抛 non-recoverable → 透传不重试", async () => {
    // 改用 401(不在 RECOVERABLE_ERROR_PATTERNS),避免 retry 3 次拖慢测试
    // [feat: feishu-attach-upload-robustness] 2026-05-24
    const p = makeFile("a.png", 100)
    const { client } = makeMock({ imageError: new Error("401 Unauthorized") })
    await expect(uploadImage(client, p)).rejects.toThrow(/401 Unauthorized/)
  })
})

describe("uploadFile", () => {
  test("小于 30MB 正常上传 → 返回 file_key + 带 file_name basename", async () => {
    const p = makeFile("report.pdf", 1024)
    const { client, fileCalls } = makeMock({ fileKey: "file_TEST_1" })
    const key = await uploadFile(client, p, "pdf")
    expect(key).toBe("file_TEST_1")
    expect(fileCalls).toHaveLength(1)
    expect(fileCalls[0]!.fields).toEqual({ file_type: "pdf", file_name: "report.pdf" })
  })

  test("stream fileType 也工作(兜底)", async () => {
    const p = makeFile("a.docx", 100)
    const { client, fileCalls } = makeMock()
    await uploadFile(client, p, "stream")
    expect(fileCalls[0]!.fields.file_type).toBe("stream")
  })

  test("中文名 → file_name 字段保留原 UTF-8(Bun-native FormData 自动 RFC 8187)", async () => {
    // [feat: feishu-attach-upload-robustness iter 4] 2026-05-24
    // iter 3 错误地 percent-encode 让飞书显示 raw "%E4%B8%AD..." 而不是 decode 回中文。
    // iter 4 改用 Bun-native FormData → 自动处理 UTF-8 multipart filename,飞书 server 正确 decode。
    const p = makeFile("中文报告.pdf", 1024)
    const { client, fileCalls } = makeMock({ fileKey: "file_zh" })
    await uploadFile(client, p, "pdf")
    expect(fileCalls[0]!.fields.file_name).toBe("中文报告.pdf")
  })

  test("超 30MB → 抛 size 错", async () => {
    const p = makeFile("big.mp4", MAX_FILE_BYTES + 1)
    const { client, fileCalls } = makeMock()
    await expect(uploadFile(client, p, "mp4")).rejects.toThrow(/超过/)
    expect(fileCalls).toHaveLength(0)
  })

  test("SDK 返 null → 抛", async () => {
    const p = makeFile("a.pdf", 100)
    const { client } = makeMock({ fileKey: null })
    await expect(uploadFile(client, p, "pdf")).rejects.toThrow(/未返回 file_key/)
  })
})

describe("sendImageMessage / sendFileMessage", () => {
  test("sendImageMessage:msg_type=image + content image_key JSON", async () => {
    const { client, messageCalls } = makeMock()
    await sendImageMessage(client, "oc_chat_x", "img_KEY_1")
    expect(messageCalls).toHaveLength(1)
    expect(messageCalls[0]!.receive_id).toBe("oc_chat_x")
    expect(messageCalls[0]!.msg_type).toBe("image")
    expect(JSON.parse(messageCalls[0]!.content)).toEqual({ image_key: "img_KEY_1" })
  })

  test("sendFileMessage:msg_type=file + content file_key JSON", async () => {
    const { client, messageCalls } = makeMock()
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
    const { client, imageCalls } = makeMock({
      imageErrorsPerCall: [new Error("socket connection closed unexpectedly"), undefined],
    })
    const key = await uploadImage(client, p, FAST_RETRY)
    expect(key).toBe("img_key_fake")
    expect(imageCalls).toHaveLength(1) // 第 1 次 throw 不计 push,第 2 次成功 push
  })

  test("3 次 socket 失败 → throw,3 次 SDK 调用", async () => {
    const p = makeFile("a.png", 100)
    const err = new Error("socket connection closed unexpectedly")
    const { client, imageCalls } = makeMock({
      imageErrorsPerCall: [err, err, err],
    })
    await expect(uploadImage(client, p, FAST_RETRY)).rejects.toThrow(/socket connection closed/)
    expect(imageCalls).toHaveLength(0) // 3 次都 throw,push 都没执行
  })

  test("size 超限 → 0 次 SDK 调用(预检拦截,不进 retry)", async () => {
    const p = makeFile("big.png", MAX_IMAGE_BYTES + 1)
    const { client, imageCalls } = makeMock()
    await expect(uploadImage(client, p, FAST_RETRY)).rejects.toThrow(/超过/)
    expect(imageCalls).toHaveLength(0)
  })

  test("非可恢复(401)→ 1 次调用立即失败", async () => {
    const p = makeFile("a.png", 100)
    const { client, imageCalls } = makeMock({
      imageErrorsPerCall: [new Error("401 Unauthorized")],
    })
    await expect(uploadImage(client, p, FAST_RETRY)).rejects.toThrow(/401/)
    expect(imageCalls).toHaveLength(0)
  })
})

describe("sanitizeFileNameForUpload", () => {
  // [feat: feishu-attach-upload-robustness iter 3] RFC 5987 percent-encoding
  test("纯 ASCII 名 → 原样不动", () => {
    expect(sanitizeFileNameForUpload("report.pdf")).toBe("report.pdf")
    expect(sanitizeFileNameForUpload("a-b_c 1.txt")).toBe("a-b_c 1.txt")
  })

  test("中文名 → percent-encode", () => {
    expect(sanitizeFileNameForUpload("报告.pdf")).toBe("%E6%8A%A5%E5%91%8A.pdf")
  })

  test("中英混 → 整串 encode(保 ASCII 子串还是 7-bit)", () => {
    const out = sanitizeFileNameForUpload("第3版-final.docx")
    // 关键:含 % 序列,且服务端 decode 后能恢复原名
    expect(out).toContain("%")
    expect(decodeURIComponent(out)).toBe("第3版-final.docx")
  })

  test("含括号 / 引号 → 转 %28 / %29 / %27(form-data 兼容)", () => {
    const out = sanitizeFileNameForUpload("文件(v1)'old'.pdf")
    expect(out).toContain("%28")
    expect(out).toContain("%29")
    expect(out).toContain("%27")
  })

  test("em-dash / 全角符号 → encode 保护", () => {
    expect(sanitizeFileNameForUpload("a—b.pdf")).toMatch(/^a%E2%80%94b\.pdf$/)
  })
})

describe("uploadFile with retry (集成)", () => {
  test("socket 失败 1 次后成功 → 返 key,2 次 SDK 调用", async () => {
    const p = makeFile("a.pdf", 100)
    const { client, fileCalls } = makeMock({
      fileErrorsPerCall: [new Error("socket closed"), undefined],
    })
    const key = await uploadFile(client, p, "pdf", FAST_RETRY)
    expect(key).toBe("file_key_fake")
    expect(fileCalls).toHaveLength(1)
  })

  test("3 次 socket 失败 → throw", async () => {
    const p = makeFile("a.pdf", 100)
    const err = new Error("socket closed")
    const { client } = makeMock({
      fileErrorsPerCall: [err, err, err],
    })
    await expect(uploadFile(client, p, "pdf", FAST_RETRY)).rejects.toThrow(/socket closed/)
  })
})
