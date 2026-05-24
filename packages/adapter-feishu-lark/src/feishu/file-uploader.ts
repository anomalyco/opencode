// [fork-only] file-uploader — 飞书 image / file 上传 + 发送 IO 包装
// [feat: feishu-bridge-light] 2026-05-23
// [feat: feishu-attach-upload-robustness] 2026-05-24 — Buffer + retry + timeout
//
// 收纳跟飞书 SDK 直连的 IO,跟 reply-actions(纯函数)+ message-pipeline(状态/路由)分层:
//   - uploadImage / uploadFile:本地路径 → 上传 → 返回 key
//   - sendImageMessage / sendFileMessage:用 key 发到 chatId
//
// size 限制(SDK 文档):
//   - image:≤ 10MB
//   - file:≤ 30MB
//
// 上传前 statSync 预检 size,超限直接抛(避免大文件浪费内存读)。
//
// **重要架构决策**(feishu-attach-upload-robustness 2026-05-24):
// 用 `readFileSync` Buffer 替代 `createReadStream` Node Readable stream。
// 原因:Bun runtime fetch 处理 Node Readable stream + multipart 编码有兼容
// 性问题,实测 4.7KB 小文件都会撞 `socket connection closed unexpectedly`。
// Buffer 上传简化(SDK 内部转 multipart 不依赖 stream pipe),绕开兼容性。
// 内存代价:30MB 上限 ≪ VM 默认 4GB,short-lived 占用可忽略。

import { readFileSync, statSync } from "node:fs"
import { basename } from "node:path"
import type { Client } from "@larksuiteoapi/node-sdk"
import type { LarkFileType } from "./reply-actions"

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
  // [feishu-attach-upload-robustness] readFileSync Buffer + retry
  const buffer = readFileSync(path)
  const res = await retryUpload(
    () =>
      client.im.v1.image.create({
        data: { image_type: "message", image: buffer },
      }),
    `image ${basename(path)}`,
    retryOptions,
  )
  const key = (res as { image_key?: string } | null)?.image_key
  if (!key) throw new Error("image.create 未返回 image_key")
  return key
}

/**
 * 上传文件 → 返回 file_key
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
  // [feishu-attach-upload-robustness] readFileSync Buffer + retry
  const buffer = readFileSync(path)
  const res = await retryUpload(
    () =>
      client.im.v1.file.create({
        data: {
          file_type: fileType,
          file_name: basename(path),
          file: buffer,
        },
      }),
    `file ${basename(path)}`,
    retryOptions,
  )
  const key = (res as { file_key?: string } | null)?.file_key
  if (!key) throw new Error("file.create 未返回 file_key")
  return key
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
