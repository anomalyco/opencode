import path from "path"
import fs from "fs/promises"
import { Global } from "@/global"
import { Log } from "@/util/log"
import type { Account, AccountsFile } from "./types"
import { AccountsFileSchema } from "./types"

const log = Log.create({ service: "auth.accounts" })

/**
 * 账号管理模块
 * 从 ~/.config/opencode/accounts.json 读取账号信息
 */
export namespace Accounts {
  const ACCOUNTS_FILE = path.join(Global.Path.config, "accounts.json")

  /**
   * 读取所有账号
   */
  export async function loadAll(): Promise<Account[]> {
    try {
      const content = await fs.readFile(ACCOUNTS_FILE, "utf-8")
      const data = JSON.parse(content)
      const result = AccountsFileSchema.safeParse(data)

      if (!result.success) {
        log.error("Invalid accounts file format", { error: result.error })
        return []
      }

      return result.data
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        log.warn("Accounts file not found", { path: ACCOUNTS_FILE })
        return []
      }
      log.error("Failed to load accounts file", { error })
      return []
    }
  }

  /**
   * 验证用户名和密码
   * @returns 验证成功返回账号信息，失败返回 null
   */
  export async function verify(username: string, password: string): Promise<Account | null> {
    const accounts = await loadAll()
    const account = accounts.find((acc) => acc.username === username)

    if (!account) {
      log.info("Account not found", { username })
      return null
    }

    if (account.password !== password) {
      log.info("Invalid password", { username })
      return null
    }

    return account
  }

  /**
   * 根据用户名获取账号信息
   */
  export async function findByUsername(username: string): Promise<Account | null> {
    const accounts = await loadAll()
    return accounts.find((acc) => acc.username === username) ?? null
  }
}
