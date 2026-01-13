/**
 * ============================================================================
 * 文件名：pr.ts
 * 所属包：packages/opencode/src/cli/cmd
 * ============================================================================
 *
 * 文件作用：
 * PR 命令模块。获取并检出 GitHub PR 分支，然后运行 OpenCode。
 *
 * 主要功能：
 * - PrCommand：PR 命令
 * - 使用 gh CLI 检出 PR 分支
 * - 处理 fork PR 的远程仓库设置
 * - 从 PR 描述中检测并导入 OpenCode 会话
 * - 自动启动 OpenCode TUI（如果导入了会话则继续会话）
 *
 * 依赖关系：
 * - ../ui：UI 工具
 * - ./cmd：命令包装
 * - @/project/instance：实例管理
 * - bun：Bun shell ($)
 * - child_process：子进程生成
 *
 * 导出内容：
 * - PrCommand：PR 命令定义
 *
 * 命令参数：
 * - number：PR 编号（必需）
 *
 * 分支命名：
 * - 本地分支名格式：pr/<number>
 *
 * 会话链接检测：
 * - 在 PR 描述中查找 opncd.ai 链接
 * - 格式：https://opncd.ai/s/<session-id>
 *
 * @package opencode
 * @module cli/cmd/pr
 */

// 导入 UI 工具
import { UI } from "../ui"

// 导入命令包装
import { cmd } from "./cmd"

// 导入实例管理
import { Instance } from "@/project/instance"

// 导入 Bun shell
import { $ } from "bun"

/**
 * PR 命令
 *
 * 获取并检出 GitHub PR 分支，然后运行 OpenCode。
 */
export const PrCommand = cmd({
  command: "pr <number>",
  describe: "fetch and checkout a GitHub PR branch, then run opencode",
  builder: (yargs) =>
    yargs.positional("number", {
      type: "number",
      describe: "PR number to checkout",
      demandOption: true,
    }),
  async handler(args) {
    // 提供实例上下文
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        // 获取项目信息
        const project = Instance.project
        // 检查是否为 Git 仓库
        if (project.vcs !== "git") {
          UI.error("Could not find git repository. Please run this command from a git repository.")
          process.exit(1)
        }

        // 获取 PR 编号
        const prNumber = args.number
        // 生成本地分支名
        const localBranchName = `pr/${prNumber}`
        UI.println(`Fetching and checking out PR #${prNumber}...`)

        // 使用 gh pr checkout 并指定自定义分支名
        const result = await $`gh pr checkout ${prNumber} --branch ${localBranchName} --force`.nothrow()

        // 检查 checkout 是否成功
        if (result.exitCode !== 0) {
          UI.error(`Failed to checkout PR #${prNumber}. Make sure you have gh CLI installed and authenticated.`)
          process.exit(1)
        }

        // ==================== 获取 PR 信息 ====================
        // 用于 fork 处理和会话链接检测
        const prInfoResult =
          await $`gh pr view ${prNumber} --json headRepository,headRepositoryOwner,isCrossRepository,headRefName,body`.nothrow()

        // 会话 ID（如果找到）
        let sessionId: string | undefined

        // 解析 PR 信息
        if (prInfoResult.exitCode === 0) {
          const prInfoText = prInfoResult.text()
          if (prInfoText.trim()) {
            const prInfo = JSON.parse(prInfoText)

            // ==================== 处理 fork PR ====================
            if (prInfo && prInfo.isCrossRepository && prInfo.headRepository && prInfo.headRepositoryOwner) {
              // 获取 fork 的所有者和名称
              const forkOwner = prInfo.headRepositoryOwner.login
              const forkName = prInfo.headRepository.name
              // 远程仓库名使用所有者名称
              const remoteName = forkOwner

              // 检查远程仓库是否已存在
              const remotes = (await $`git remote`.nothrow().text()).trim()
              if (!remotes.split("\n").includes(remoteName)) {
                // 添加 fork 远程仓库
                await $`git remote add ${remoteName} https://github.com/${forkOwner}/${forkName}.git`.nothrow()
                UI.println(`Added fork remote: ${remoteName}`)
              }

              // 设置上游到 fork，这样推送会到 fork
              const headRefName = prInfo.headRefName
              await $`git branch --set-upstream-to=${remoteName}/${headRefName} ${localBranchName}`.nothrow()
            }

            // ==================== 检测 OpenCode 会话链接 ====================
            if (prInfo && prInfo.body) {
              // 在 PR 描述中查找 opncd.ai 链接
              const sessionMatch = prInfo.body.match(/https:\/\/opncd\.ai\/s\/([a-zA-Z0-9_-]+)/)
              if (sessionMatch) {
                const sessionUrl = sessionMatch[0]
                UI.println(`Found opencode session: ${sessionUrl}`)
                UI.println(`Importing session...`)

                // 导入会话
                const importResult = await $`opencode import ${sessionUrl}`.nothrow()
                if (importResult.exitCode === 0) {
                  const importOutput = importResult.text().trim()
                  // 从输出中提取会话 ID（格式："Imported session: <session-id>"）
                  const sessionIdMatch = importOutput.match(/Imported session: ([a-zA-Z0-9_-]+)/)
                  if (sessionIdMatch) {
                    sessionId = sessionIdMatch[1]
                    UI.println(`Session imported: ${sessionId}`)
                  }
                }
              }
            }
          }
        }

        // 显示成功消息
        UI.println(`Successfully checked out PR #${prNumber} as branch '${localBranchName}'`)
        UI.println()
        UI.println("Starting opencode...")
        UI.println()

        // ==================== 启动 OpenCode TUI ====================
        const { spawn } = await import("child_process")
        // 如果有会话 ID，添加 -s 参数继续会话
        const opencodeArgs = sessionId ? ["-s", sessionId] : []
        // 生成 opencode 子进程
        const opencodeProcess = spawn("opencode", opencodeArgs, {
          stdio: "inherit",
          cwd: process.cwd(),
        })

        // 等待进程结束
        await new Promise<void>((resolve, reject) => {
          opencodeProcess.on("exit", (code) => {
            if (code === 0) resolve()
            else reject(new Error(`opencode exited with code ${code}`))
          })
          opencodeProcess.on("error", reject)
        })
      },
    })
  },
})
