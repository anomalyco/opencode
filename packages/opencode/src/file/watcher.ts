/**
 * ============================================================================
 * 文件名：watcher.ts
 * 所属包：packages/opencode/src/file
 * ============================================================================
 *
 * 文件作用：
 * 文件监视模块。使用 Parcel watcher 监视文件系统变化，
 * 发布文件更新事件供其他模块订阅。
 *
 * 主要功能：
 * - Event.Updated：文件更新事件
 * - init()：初始化文件监视器
 * - state：监视器订阅状态
 *
 * 依赖关系：
 * - ../bus/bus-event：事件定义
 * - ../bus：事件总线
 * - zod：类型验证
 * - ../project/instance：实例状态
 * - ../util/log：日志记录
 * - ./ignore：忽略规则
 * - ../config/config：配置系统
 * - path：路径处理
 * - @parcel/watcher/wrapper：文件监视器包装器
 * - @parcel/watcher：Parcel watcher 类型
 * - ../util/lazy：懒加载
 * - ../util/timeout：超时处理
 * - bun：Bun 运行时（$）
 * - ../flag/flag：功能标志
 * - fs/promises：文件系统 promise API
 *
 * 导出内容：
 * - FileWatcher namespace：文件监视器命名空间
 *   - Event：监视器事件
 *   - init()：初始化函数
 *
 * 监视逻辑：
 * - 仅在 Git 仓库中启用
 * - 使用平台特定的后端（fs-events/inotify/windows）
 * - 同时监视项目目录和 .git 目录
 * - 忽略配置的规则
 *
 * @package opencode
 * @module file/watcher
 */

// 导入事件定义
import { BusEvent } from "@/bus/bus-event"

// 导入事件总线
import { Bus } from "@/bus"

// 导入 Zod
import z from "zod"

// 导入实例管理
import { Instance } from "../project/instance"

// 导入日志工具
import { Log } from "../util/log"

// 导入忽略规则
import { FileIgnore } from "./ignore"

// 导入配置系统
import { Config } from "../config/config"

// 导入路径模块
import path from "path"

// 导入 Parcel watcher 包装器
// @ts-ignore
import { createWrapper } from "@parcel/watcher/wrapper"

// 导入懒加载工具
import { lazy } from "@/util/lazy"

// 导入超时工具
import { withTimeout } from "@/util/timeout"

// 导入 Parcel watcher 类型
import type ParcelWatcher from "@parcel/watcher"

// 导入 Bun shell
import { $ } from "bun"

// 导入功能标志
import { Flag } from "@/flag/flag"

// 导入文件系统 promise API
import { readdir } from "fs/promises"

// 订阅超时时间（10 秒）
const SUBSCRIBE_TIMEOUT_MS = 10_000

// 声明全局 libc 变量（用于 Linux）
declare const OPENCODE_LIBC: string | undefined

/**
 * 文件监视器命名空间
 *
 * 监视文件系统变化并发布事件。
 */
export namespace FileWatcher {
  // 创建日志记录器
  const log = Log.create({ service: "file.watcher" })

  /**
   * 文件监视器事件
   *
   * 定义与文件监视相关的事件。
   */
  export const Event = {
    /**
     * 文件更新事件
     *
     * 当文件被添加、修改或删除时发布。
     */
    Updated: BusEvent.define(
      "file.watcher.updated",
      z.object({
        file: z.string(),
        event: z.union([z.literal("add"), z.literal("change"), z.literal("unlink")]),
      }),
    ),
  }

  /**
   * 懒加载的 Parcel watcher
   *
   * 根据平台和架构动态加载对应的原生绑定。
   */
  const watcher = lazy(() => {
    // 根据平台和架构加载对应的绑定
    const binding = require(
      `@parcel/watcher-${process.platform}-${process.arch}${process.platform === "linux" ? `-${OPENCODE_LIBC || "glibc"}` : ""}`,
    )
    return createWrapper(binding) as typeof import("@parcel/watcher")
  })

  /**
   * 监视器状态
   *
   * 实例级状态，管理 Parcel watcher 订阅。
   * 清理时自动取消所有订阅。
   */
  const state = Instance.state(
    async () => {
      // 只在 Git 仓库中启用监视
      if (Instance.project.vcs !== "git") return {}

      log.info("init")

      // 获取配置
      const cfg = await Config.get()

      // 确定平台特定的后端
      const backend = (() => {
        if (process.platform === "win32") return "windows"
        if (process.platform === "darwin") return "fs-events"
        if (process.platform === "linux") return "inotify"
      })()

      // 平台不支持
      if (!backend) {
        log.error("watcher backend not supported", { platform: process.platform })
        return {}
      }

      log.info("watcher backend", { platform: process.platform, backend })

      // 订阅回调函数
      const subscribe: ParcelWatcher.SubscribeCallback = (err, evts) => {
        if (err) return
        for (const evt of evts) {
          // 将 Parcel 事件转换为 Bus 事件
          if (evt.type === "create") Bus.publish(Event.Updated, { file: evt.path, event: "add" })
          if (evt.type === "update") Bus.publish(Event.Updated, { file: evt.path, event: "change" })
          if (evt.type === "delete") Bus.publish(Event.Updated, { file: evt.path, event: "unlink" })
        }
      }

      // 订阅列表
      const subs: ParcelWatcher.AsyncSubscription[] = []

      // 配置的忽略规则
      const cfgIgnores = cfg.watcher?.ignore ?? []

      // 如果启用实验性文件监视器
      if (Flag.OPENCODE_EXPERIMENTAL_FILEWATCHER) {
        // 订阅项目目录
        const pending = watcher().subscribe(Instance.directory, subscribe, {
          ignore: [...FileIgnore.PATTERNS, ...cfgIgnores],
          backend,
        })

        // 带超时的订阅
        const sub = await withTimeout(pending, SUBSCRIBE_TIMEOUT_MS).catch((err) => {
          log.error("failed to subscribe to Instance.directory", { error: err })
          pending.then((s) => s.unsubscribe()).catch(() => {})
          return undefined
        })

        if (sub) subs.push(sub)
      }

      // 获取 .git 目录路径
      const vcsDir = await $`git rev-parse --git-dir`
        .quiet()
        .nothrow()
        .cwd(Instance.worktree)
        .text()
        .then((x) => path.resolve(Instance.worktree, x.trim()))
        .catch(() => undefined)

      // 订阅 .git 目录（用于检测分支切换等）
      if (vcsDir && !cfgIgnores.includes(".git") && !cfgIgnores.includes(vcsDir)) {
        // 获取 .git 目录内容
        const gitDirContents = await readdir(vcsDir).catch(() => [])
        // 忽略除 HEAD 外的所有文件
        const ignoreList = gitDirContents.filter((entry) => entry !== "HEAD")

        const pending = watcher().subscribe(vcsDir, subscribe, {
          ignore: ignoreList,
          backend,
        })

        const sub = await withTimeout(pending, SUBSCRIBE_TIMEOUT_MS).catch((err) => {
          log.error("failed to subscribe to vcsDir", { error: err })
          pending.then((s) => s.unsubscribe()).catch(() => {})
          return undefined
        })

        if (sub) subs.push(sub)
      }

      return { subs }
    },
    // 清理函数：取消所有订阅
    async (state) => {
      if (!state.subs) return
      await Promise.all(state.subs.map((sub) => sub?.unsubscribe()))
    },
  )

  /**
   * 初始化文件监视器
   *
   * 如果未禁用文件监视器，启动监视。
   */
  export function init() {
    if (Flag.OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER) {
      return
    }
    state()
  }
}
