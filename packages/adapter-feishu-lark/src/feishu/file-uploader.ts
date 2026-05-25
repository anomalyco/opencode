// [fork-only] file-uploader — 飞书 image / file 上传 + 发送 IO 包装
// [feat: feishu-bridge-light] 2026-05-23
// [feat: feishu-attach-upload-robustness] 2026-05-24 — 总主题
// [feat: feishu-attach-upload-robustness iter 4] 2026-05-24 — 绕开 SDK,Bun-native fetch + FormData + Blob
//
// 收纳跟飞书 SDK 直连的 IO,跟 reply-actions(纯函数)+ message-pipeline(状态/路由)分层:
//   - uploadImage / uploadFile:本地路径 → 上传 → 返回 key
//   - sendImageMessage / sendFileMessage:用 key 发到 chatId
//
// size 限制(飞书 API 文档):
//   - image:≤ 10MB
//   - file:≤ 30MB
//
// 上传前 statSync 预检 size,超限直接抛(避免大文件浪费内存读)。
//
// **iter 4 关键架构决策**(2026-05-24):
//
// 之前迭代全部死在 Bun runtime + axios + form-data 互操作:
//   - iter 0(createReadStream):"socket connection closed unexpectedly"(Bun fetch 跟 chunked
//     上传配合 fail)
//   - iter 2(Readable.from(buffer)):form-data 算不出 Content-Length → chunked → Feishu
//     /im/v1/files server hang 30s × 3 retry
//   - iter 1+3(raw Buffer):**plugin bundle 里 `Buffer.isBuffer(buffer) === false`** —
//     bun build 把 form-data CJS 打成 bundle 时 `Buffer` 引用跟 runtime 的 `node:fs`
//     返回的 Buffer 不是同一个 class(Bun bundle interop 怪相)。**isStreamLike(buffer)
//     返 true** → form-data 当 stream 处理 → `source.on is not a function` 直 crash。
//
// **iter 4 解法**:**完全绕开 SDK 的 image.create / file.create 调用**,改用 Bun-native
// `fetch + FormData + Blob`。
//   - Bun-native FormData 用标准 Blob 处理 binary,无 Node form-data 的"Buffer vs stream"
//     歧义,无 DelayedStream wrapper,无 chunked encoding 选择问题
//   - 飞书 multipart endpoint 直接拿到标准 `Content-Disposition` + `Content-Length`,
//     正常 200 OK 返 file_key / image_key
//   - tenant_access_token 从 SDK client 内部 `tokenManager` 拿(SDK 内部 cached,免 boilerplate)
//   - SDK 仍然用于 `message.create`(非 multipart,工作正常)— 这是 sendImageMessage /
//     sendFileMessage 保留不动的原因
//
// **不依赖 OpenClaw 任何包**(2026-05-08 立的强约束),只参考其文件名净化思路。
//
// 同时保留 `sanitizeFileNameForUpload`:中文 / 全角 / em-dash 等非 ASCII 文件名 RFC 5987
// percent-encoding 保 Content-Disposition header 7-bit clean(飞书 server 端 decode 还原)。
//
// 内存代价:30MB 上限 ≪ VM 默认 4GB,short-lived 可忽略。

import { readFileSync, statSync } from "node:fs"
import { basename } from "node:path"
import type { Client } from "@larksuiteoapi/node-sdk"
import type { LarkFileType } from "./reply-actions"

/**
 * 从 SDK Client 取 tenant_access_token + domain URL。
 *
 * 利用 SDK 内部 `tokenManager` cache(2h 自动刷新),免我们自己做 auth boilerplate。
 * 字段全部 internal 但稳定 — SDK v1.50 至今未改这两个名字(verified
 * `node_modules/.../lib/index.js:81550-81553`)。
 */
async function getClientAuthContext(client: Client): Promise<{
  token: string
  domain: string
}> {
  const internal = client as unknown as {
    domain: string
    tokenManager: { getTenantAccessToken: (opts: object) => Promise<string> }
  }
  if (!internal.tokenManager?.getTenantAccessToken) {
    throw new Error("[file-uploader] SDK Client 缺 tokenManager — 升级 SDK 后内部字段可能改了")
  }
  if (!internal.domain) {
    throw new Error("[file-uploader] SDK Client 缺 domain — 升级 SDK 后内部字段可能改了")
  }
  const token = await internal.tokenManager.getTenantAccessToken({})
  if (!token) throw new Error("[file-uploader] tokenManager 返空 token,鉴权可能失败")
  return { token, domain: internal.domain }
}

/**
 * Bun-native 上传 — 用 fetch + FormData + Blob,绕开 axios + form-data 全部坑。
 *
 * 输入:
 *   - endpoint:完整 URL(`<domain>/open-apis/im/v1/files` 或 `.../images`)
 *   - token:tenant_access_token
 *   - fields:multipart 字段 dict(string)+ file 字段(Buffer + filename)
 *   - keyField:返 JSON 中提 key 的字段名(`file_key` 或 `image_key`)
 *
 * 输出:飞书返回的 key 字符串
 */
export async function uploadMultipartViaFetch(opts: {
  endpoint: string
  token: string
  /** multipart 非文件字段(string)— image_type / file_type / file_name 等 */
  fields: Record<string, string>
  /** multipart 文件字段名 — `/files` 用 "file" / `/images` 用 "image" */
  fileFieldName: "file" | "image"
  fileBuffer: Buffer
  fileName: string
  /** 返回 JSON 中提取 key 的字段名 */
  keyField: "file_key" | "image_key"
}): Promise<string> {
  const form = new FormData()
  for (const [k, v] of Object.entries(opts.fields)) {
    form.append(k, v)
  }
  // Bun-native Blob — 包成 Uint8Array view 避开 Buffer 跟 BlobPart 的 ArrayBufferLike vs ArrayBuffer 类型不兼容
  // (Buffer.buffer 类型是 ArrayBufferLike,可能是 SharedArrayBuffer;new Uint8Array(buf) 强制走 ArrayBuffer)
  form.append(
    opts.fileFieldName,
    new Blob([new Uint8Array(opts.fileBuffer)]),
    opts.fileName,
  )
  const res = await fetch(opts.endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.token}` },
    body: form,
  })
  if (!res.ok) {
    throw new Error(`upload HTTP ${res.status} ${res.statusText}`)
  }
  const json = (await res.json()) as {
    code?: number
    msg?: string
    data?: Record<string, string>
  }
  if (json.code !== 0) {
    // 飞书业务错误带 code + msg,丢进 Error.message 给上层 isRecoverableError 判断
    throw new Error(`feishu code=${json.code} msg=${json.msg ?? "unknown"}`)
  }
  const key = json.data?.[opts.keyField]
  if (!key) throw new Error(`未返回 ${opts.keyField}`)
  return key
}

/**
 * 把非 ASCII 文件名做 RFC 5987 percent-encoding。
 *
 * **为什么需要**:飞书 multipart upload 走 form-data 库,filename 字段直接拼到
 * `Content-Disposition` header,**非 ASCII 字符会让飞书服务端静默失败**(返
 * 200 + 空 file_key,SDK 抛 "未返回 file_key")。Encoding 后 header 7-bit clean,
 * 服务端解码还原显示名,user 看到的还是原中文名。
 *
 * 参考:OpenClaw `media.ts:228-237` 同款实现(经实测验证)。
 */
export function sanitizeFileNameForUpload(fileName: string): string {
  const ASCII_ONLY = /^[\x20-\x7E]+$/
  if (ASCII_ONLY.test(fileName)) return fileName
  return encodeURIComponent(fileName)
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
}

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_FILE_BYTES = 30 * 1024 * 1024

/** 上传超时(ms)— 30MB / 1MB/s = 30s 估算 + 缓冲 */
export const UPLOAD_TIMEOUT_MS = 30_000

/** retry 退避(ms)— [初次失败后 +1s, 第二次失败后 +3s];总尝试 = 1 + length */
export const RETRY_DELAYS_MS: ReadonlyArray<number> = [1000, 3000]

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

/**
 * 可恢复错误模式 — 仅对网络/服务端瞬时错误重试,业务错误(4xx / size 超限 /
 * file_type 不支持)直接失败不重试。
 *
 * `socket.*closed` 覆盖飞书 SDK 报的"The socket connection was closed unexpectedly"。
 */
export const RECOVERABLE_ERROR_PATTERNS: ReadonlyArray<RegExp> = [
  /socket.*closed/i,
  /econnreset/i,
  /epipe/i,
  /network.*error/i,
  /timeout/i,
  /\b5\d{2}\b/, // 5xx HTTP status
]

/**
 * 判断错误是否可恢复(应重试)。
 * 输入:任意 caught 的错误对象(SDK throw 通常是 Error)。
 * 输出:true = 命中至少一条 RECOVERABLE pattern,false = 业务错误。
 */
export function isRecoverableError(err: unknown): boolean {
  const msg = (err as { message?: string } | null)?.message ?? String(err)
  return RECOVERABLE_ERROR_PATTERNS.some((re) => re.test(msg))
}

/**
 * Promise.race 实现的显式超时 — Lark SDK 不接 AbortSignal,只能软超时(后端
 * 请求继续跑,前端 Promise reject)。Promise 超时后 GC 处理。
 *
 * 输入:待执行 Promise + 超时 ms + 日志 label。
 * 输出:超时 reject `Error('label timeout after Nms')`,不超时返原 Promise 结果。
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timeout after ${timeoutMs}ms`)),
      timeoutMs,
    )
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * 重试包装 — 至多 (delaysMs.length + 1) 次尝试。
 *
 * 行为:
 *   - 成功 → 立即返(成功不延迟)
 *   - 失败 + 可恢复 + 未到上限 → 等退避时间 → 再试
 *   - 失败 + 不可恢复 → 立即 throw(不浪费 retry 时间)
 *   - 失败 + 到上限 → throw 最后一次错误
 *
 * 每次尝试包 `withTimeout` 防止单次永久卡住。
 *
 * 输入:执行函数 fn + 日志 label + 可选 options(默认 prod 值)
 * 输出:fn 的最终结果,或最后一次错误的 reject。
 *
 * options:
 *   - delaysMs:重试退避数组,默认 `RETRY_DELAYS_MS`(prod = [1000, 3000])
 *   - timeoutMs:单次超时,默认 `UPLOAD_TIMEOUT_MS`(prod = 30_000)
 *   - 测试用 `{ delaysMs: [10, 10] }` 让快测试不等真 1+3 秒
 */
export interface RetryUploadOptions {
  delaysMs?: ReadonlyArray<number>
  timeoutMs?: number
}

export async function retryUpload<T>(
  fn: () => Promise<T>,
  label: string,
  options: RetryUploadOptions = {},
): Promise<T> {
  const delaysMs = options.delaysMs ?? RETRY_DELAYS_MS
  const timeoutMs = options.timeoutMs ?? UPLOAD_TIMEOUT_MS
  let lastErr: unknown
  for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
    try {
      const result = await withTimeout(fn(), timeoutMs, label)
      if (attempt > 0) {
        console.log(`[file-uploader] ${label} 重试第 ${attempt} 次成功`)
      }
      return result
    } catch (err) {
      lastErr = err
      const final = attempt >= delaysMs.length
      const recoverable = isRecoverableError(err)
      if (final || !recoverable) {
        if (attempt > 0) {
          console.warn(
            `[file-uploader] ${label} 重试 ${attempt} 次最终失败:`,
            (err as Error).message,
          )
        } else if (!recoverable) {
          // 第一次就因业务错误失败,不重试(透明输出)
          console.warn(
            `[file-uploader] ${label} 业务错误不重试:`,
            (err as Error).message,
          )
        }
        throw err
      }
      const delay = delaysMs[attempt]!
      console.warn(
        `[file-uploader] ${label} 第 ${attempt + 1} 次失败,${delay}ms 后重试:`,
        (err as Error).message,
      )
      await new Promise<void>((resolve) => setTimeout(resolve, delay))
    }
  }
  // 理论不可达 — for 循环要么 return 要么 throw
  throw lastErr ?? new Error(`[file-uploader] ${label} retry loop logic error`)
}

/**
 * 上传图片 → 返回 image_key
 *
 * iter 4:走 Bun-native fetch 绕 SDK image.create(SDK 路径死在 form-data 兼容)
 *
 * @param retryOptions 可选 — 测试用快退避(prod 用 RETRY_DELAYS_MS 默认)
 */
export async function uploadImage(
  client: Client,
  path: string,
  retryOptions?: RetryUploadOptions,
): Promise<string> {
  const size = statSync(path).size
  if (size > MAX_IMAGE_BYTES) {
    throw new Error(
      `image ${basename(path)} ${humanSize(size)} 超过 ${humanSize(MAX_IMAGE_BYTES)} 限制`,
    )
  }
  const buffer = readFileSync(path)
  const fileName = basename(path)
  return retryUpload(
    async () => {
      const { token, domain } = await getClientAuthContext(client)
      return uploadMultipartViaFetch({
        endpoint: `${domain}/open-apis/im/v1/images`,
        token,
        fields: { image_type: "message" },
        fileFieldName: "image",
        fileBuffer: buffer,
        fileName,
        keyField: "image_key",
      })
    },
    `image ${fileName}`,
    retryOptions,
  )
}

/**
 * 上传文件 → 返回 file_key
 *
 * iter 4:走 Bun-native fetch 绕 SDK file.create
 *
 * **不做 percent-encoding**:Bun-native FormData 自动按 RFC 8187 处理 UTF-8 filename
 * (multipart `Content-Disposition` header),飞书 server 正确 decode 回中文。OpenClaw 的
 * sanitizeFileNameForUpload 是给 Node form-data 库走 SDK 路径用的兜底,iter 4 已经完全
 * 绕开 SDK,不需要也不能做(否则飞书显示成 %E6%8A%A5%E5%91%8A.md raw 字符串)。
 *
 * @param retryOptions 可选 — 测试用快退避
 */
export async function uploadFile(
  client: Client,
  path: string,
  fileType: LarkFileType,
  retryOptions?: RetryUploadOptions,
): Promise<string> {
  const size = statSync(path).size
  if (size > MAX_FILE_BYTES) {
    throw new Error(
      `file ${basename(path)} ${humanSize(size)} 超过 ${humanSize(MAX_FILE_BYTES)} 限制`,
    )
  }
  const buffer = readFileSync(path)
  const fileName = basename(path)
  return retryUpload(
    async () => {
      const { token, domain } = await getClientAuthContext(client)
      return uploadMultipartViaFetch({
        endpoint: `${domain}/open-apis/im/v1/files`,
        token,
        fields: { file_type: fileType, file_name: fileName },
        fileFieldName: "file",
        fileBuffer: buffer,
        fileName,
        keyField: "file_key",
      })
    },
    `file ${fileName}`,
    retryOptions,
  )
}

/** 用 image_key 发图片消息 */
export async function sendImageMessage(
  client: Client,
  chatId: string,
  imageKey: string,
): Promise<void> {
  await client.im.v1.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: chatId,
      msg_type: "image",
      content: JSON.stringify({ image_key: imageKey }),
    },
  })
}

/** 用 file_key 发文件消息 */
export async function sendFileMessage(
  client: Client,
  chatId: string,
  fileKey: string,
): Promise<void> {
  await client.im.v1.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: chatId,
      msg_type: "file",
      content: JSON.stringify({ file_key: fileKey }),
    },
  })
}
