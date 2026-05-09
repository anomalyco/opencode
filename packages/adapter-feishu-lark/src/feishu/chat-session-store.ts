// [fork-only] ChatSessionStore — chatId → opencode sessionID 持久化映射
// [feat: feishu-bridge] 2026-05-09
//
// 存盘 ~/.opencode/feishu-chat-sessions.json — 配 0600 权限。
//
// 解决问题:
//   - 之前 chatToSession 是 in-memory Map,plugin 重启后 map 丢失,
//     同 chat 下次进消息会建新 session(虽然旧 session 数据还在 db,但 user 体验断流)
//   - 现在落盘后,plugin 重启后 chatId 仍能复用之前的 session
//
// 结构:
//   { "version": 1, "sessions": { "<accountId>": { "<chatId>": "ses_xxx" } } }

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

const DEFAULT_PATH = join(homedir(), ".opencode", "feishu-chat-sessions.json")

interface ChatSessionsData {
  version: 1
  sessions: Record<string, Record<string, string>>
}

export class ChatSessionStore {
  private readonly path: string
  private data: ChatSessionsData

  constructor(path: string = DEFAULT_PATH) {
    this.path = path
    this.data = this.loadFromDisk()
  }

  private loadFromDisk(): ChatSessionsData {
    if (!existsSync(this.path)) return { version: 1, sessions: {} }
    try {
      const raw = readFileSync(this.path, "utf-8")
      const json = JSON.parse(raw) as Partial<ChatSessionsData>
      return { version: 1, sessions: json.sessions ?? {} }
    } catch (err) {
      console.warn(`[chat-session-store] failed to parse ${this.path}, fallback empty:`, err)
      return { version: 1, sessions: {} }
    }
  }

  private saveToDisk(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      writeFileSync(this.path, JSON.stringify(this.data, null, 2), {
        encoding: "utf-8",
        mode: 0o600,
      })
    } catch (err) {
      console.warn(`[chat-session-store] save ${this.path} failed:`, err)
    }
  }

  /** 获取 chatId 对应的 opencode sessionID(没有则 undefined)*/
  get(accountId: string, chatId: string): string | undefined {
    return this.data.sessions[accountId]?.[chatId]
  }

  /** 设置 chatId → sessionID 映射并立即落盘 */
  set(accountId: string, chatId: string, sessionID: string): void {
    if (!this.data.sessions[accountId]) {
      this.data.sessions[accountId] = {}
    }
    this.data.sessions[accountId]![chatId] = sessionID
    this.saveToDisk()
  }

  /** 删除指定 chatId(用于 /new slash command,future feat) */
  delete(accountId: string, chatId: string): void {
    const accountMap = this.data.sessions[accountId]
    if (!accountMap) return
    delete accountMap[chatId]
    if (Object.keys(accountMap).length === 0) {
      delete this.data.sessions[accountId]
    }
    this.saveToDisk()
  }

  /** 删整个 account 的所有 chat 映射(account 解绑时调用)*/
  deleteAccount(accountId: string): void {
    if (!(accountId in this.data.sessions)) return
    delete this.data.sessions[accountId]
    this.saveToDisk()
  }

  /** 列出 account 内所有 chatId(诊断用)*/
  listChats(accountId: string): string[] {
    return Object.keys(this.data.sessions[accountId] ?? {})
  }
}
