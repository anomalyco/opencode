// [fork-only] file-uploader — 飞书 image / file 上传 + 发送 IO 包装
// [feat: feishu-bridge-light] 2026-05-23
//
// 收纳跟飞书 SDK 直连的 IO,跟 reply-actions(纯函数)+ message-pipeline(状态/路由)分层:
//   - uploadImage / uploadFile:本地路径 → 上传 → 返回 key
//   - sendImageMessage / sendFileMessage:用 key 发到 chatId
//
// size 限制(SDK 文档):
//   - image:≤ 10MB
//   - file:≤ 30MB
//
// 上传前 statSync 预检 size,超限直接抛(避免大文件流式上传到一半才失败浪费带宽)。

import { createReadStream, statSync } from "node:fs"
import { basename } from "node:path"
import type { Client } from "@larksuiteoapi/node-sdk"
import type { LarkFileType } from "./reply-actions"

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_FILE_BYTES = 30 * 1024 * 1024

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

/** 上传图片 → 返回 image_key */
export async function uploadImage(client: Client, path: string): Promise<string> {
  const size = statSync(path).size
  if (size > MAX_IMAGE_BYTES) {
    throw new Error(
      `image ${basename(path)} ${humanSize(size)} 超过 ${humanSize(MAX_IMAGE_BYTES)} 限制`,
    )
  }
  const res = await client.im.v1.image.create({
    data: { image_type: "message", image: createReadStream(path) },
  })
  const key = (res as { image_key?: string } | null)?.image_key
  if (!key) throw new Error("image.create 未返回 image_key")
  return key
}

/** 上传文件 → 返回 file_key */
export async function uploadFile(
  client: Client,
  path: string,
  fileType: LarkFileType,
): Promise<string> {
  const size = statSync(path).size
  if (size > MAX_FILE_BYTES) {
    throw new Error(
      `file ${basename(path)} ${humanSize(size)} 超过 ${humanSize(MAX_FILE_BYTES)} 限制`,
    )
  }
  const res = await client.im.v1.file.create({
    data: {
      file_type: fileType,
      file_name: basename(path),
      file: createReadStream(path),
    },
  })
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
