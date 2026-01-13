/**
 * ============================================================================
 * 文件名：upgrade.ts
 * 所属包：packages/opencode/src/cli/cmd
 * ============================================================================
 *
 * 文件作用：
 * 升级命令模块。将 OpenCode 升级到最新版本或指定版本。
 *
 * 主要功能：
 * - UpgradeCommand：升级命令
 * - 自动检测安装方法
 * - 支持指定目标版本
 * - 支持指定安装方法（curl、npm、pnpm、bun、brew）
 * - 处理 "unknown" 安装方法的确认
 * - 检查是否已是目标版本
 * - 执行升级并显示进度
 *
 * 依赖关系：
 * - yargs：命令行参数解析
 * - ../ui：UI 工具
 * - @clack/prompts：交互式提示
 * - ../../installation：安装/升级逻辑
 *
 * 导出内容：
 * - UpgradeCommand：升级命令定义
 *
 * 命令参数：
 * - target：目标版本（可选），例如 "0.1.48" 或 "v0.1.48"
 * - --method (-m)：安装方法（curl、npm、pnpm、bun、brew）
 *
 * 升级逻辑：
 * - 如果未指定目标版本，获取最新版本
 * - 如果已是目标版本，跳过升级
 * - 调用 Installation.upgrade() 执行升级
 *
 * @package opencode
 * @module cli/cmd/upgrade
 */

// 导入 yargs 类型
import type { Argv } from "yargs"

// 导入 UI 工具
import { UI } from "../ui"

// 导入交互式提示
import * as prompts from "@clack/prompts"

// 导入安装/升级逻辑
import { Installation } from "../../installation"

/**
 * 升级命令
 *
 * 将 OpenCode 升级到最新版本或指定版本。
 */
export const UpgradeCommand = {
  command: "upgrade [target]",
  describe: "upgrade opencode to the latest or a specific version",
  builder: (yargs: Argv) => {
    return yargs
      // 目标版本位置参数
      .positional("target", {
        describe: "version to upgrade to, for ex '0.1.48' or 'v0.1.48'",
        type: "string",
      })
      // 安装方法选项
      .option("method", {
        alias: "m",
        describe: "installation method to use",
        type: "string",
        choices: ["curl", "npm", "pnpm", "bun", "brew"],
      })
  },
  handler: async (args: { target?: string; method?: string }) => {
    // 打印 Logo
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    // 显示升级提示
    prompts.intro("Upgrade")

    // 检测当前安装方法
    const detectedMethod = await Installation.method()
    // 使用指定方法或检测到的方法
    const method = (args.method as Installation.Method) ?? detectedMethod

    // 处理 "unknown" 安装方法
    if (method === "unknown") {
      prompts.log.error(`opencode is installed to ${process.execPath} and may be managed by a package manager`)
      // 询问是否继续安装
      const install = await prompts.select({
        message: "Install anyways?",
        options: [
          { label: "Yes", value: true },
          { label: "No", value: false },
        ],
        initialValue: false,
      })
      // 用户选择不安装
      if (!install) {
        prompts.outro("Done")
        return
      }
    }

    // 显示使用的方法
    prompts.log.info("Using method: " + method)

    // 确定目标版本
    // 如果指定了目标，去掉 "v" 前缀；否则获取最新版本
    const target = args.target ? args.target.replace(/^v/, "") : await Installation.latest()

    // 检查是否已是目标版本
    if (Installation.VERSION === target) {
      prompts.log.warn(`opencode upgrade skipped: ${target} is already installed`)
      prompts.outro("Done")
      return
    }

    // 显示版本变更
    prompts.log.info(`From ${Installation.VERSION} → ${target}`)

    // 执行升级
    const spinner = prompts.spinner()
    spinner.start("Upgrading...")
    const err = await Installation.upgrade(method, target).catch((err) => err)

    // 处理升级错误
    if (err) {
      spinner.stop("Upgrade failed", 1)
      // UpgradeFailedError：显示 stderr
      if (err instanceof Installation.UpgradeFailedError) prompts.log.error(err.data.stderr)
      // 其他错误：显示消息
      else if (err instanceof Error) prompts.log.error(err.message)
      prompts.outro("Done")
      return
    }

    // 升级成功
    spinner.stop("Upgrade complete")
    prompts.outro("Done")
  },
}
