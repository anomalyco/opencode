/**
 * ============================================================================
 * 文件名：models.ts
 * 所属包：packages/opencode/src/cli/cmd
 * ============================================================================
 *
 * 文件作用：
 * 模型列表命令模块。提供列出所有可用 AI 模型的功能。
 *
 * 主要功能：
 * - ModelsCommand：列出可用模型命令
 * - 按提供商过滤模型
 * - 刷新模型缓存
 * - 详细模式显示模型元数据
 *
 * 依赖关系：
 * - yargs：命令行参数解析
 * - ../../project/instance：实例管理
 * - ../../provider/provider：提供商管理
 * - ../../provider/models：模型数据库
 * - ./cmd：命令包装
 * - ../ui：UI 工具
 * - os：行尾符
 *
 * 导出内容：
 * - ModelsCommand：模型列表命令定义
 *
 * 命令参数：
 * - provider：按提供商 ID 过滤（可选）
 * - verbose：显示详细模型元数据（可选）
 * - refresh：刷新模型缓存（可选）
 *
 * 排序规则：
 * - opencode 提供商优先
 * - 其他提供商按字母顺序
 * - 同一提供商内的模型按字母顺序
 *
 * @package opencode
 * @module cli/cmd/models
 */

// 导入 yargs 类型
import type { Argv } from "yargs"

// 导入实例管理
import { Instance } from "../../project/instance"

// 导入提供商管理
import { Provider } from "../../provider/provider"

// 导入模型数据库
import { ModelsDev } from "../../provider/models"

// 导入命令包装
import { cmd } from "./cmd"

// 导入 UI 工具
import { UI } from "../ui"

// 导入行尾符
import { EOL } from "os"

/**
 * 模型列表命令
 *
 * 列出所有可用的 AI 模型。
 */
export const ModelsCommand = cmd({
  command: "models [provider]",
  describe: "list all available models",
  builder: (yargs: Argv) => {
    return yargs
      // 提供商过滤参数
      .positional("provider", {
        describe: "provider ID to filter models by",
        type: "string",
        array: false,
      })
      // 详细输出参数
      .option("verbose", {
        describe: "use more verbose model output (includes metadata like costs)",
        type: "boolean",
      })
      // 刷新缓存参数
      .option("refresh", {
        describe: "refresh the models cache from models.dev",
        type: "boolean",
      })
  },
  handler: async (args) => {
    // 如果请求刷新，刷新模型缓存
    if (args.refresh) {
      await ModelsDev.refresh()
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Models cache refreshed" + UI.Style.TEXT_NORMAL)
    }

    // 提供实例上下文
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        // 获取所有提供商
        const providers = await Provider.list()

        /**
         * 打印指定提供商的模型
         *
         * @param providerID - 提供商 ID
         * @param verbose - 是否显示详细信息
         */
        function printModels(providerID: string, verbose?: boolean) {
          // 获取提供商数据
          const provider = providers[providerID]
          // 按模型 ID 字母顺序排序
          const sortedModels = Object.entries(provider.models).sort(([a], [b]) => a.localeCompare(b))
          // 遍历并打印每个模型
          for (const [modelID, model] of sortedModels) {
            // 打印提供商/模型 ID
            process.stdout.write(`${providerID}/${modelID}`)
            process.stdout.write(EOL)
            // 如果 verbose 模式，打印完整元数据
            if (verbose) {
              process.stdout.write(JSON.stringify(model, null, 2))
              process.stdout.write(EOL)
            }
          }
        }

        // 如果指定了提供商，只显示该提供商的模型
        if (args.provider) {
          const provider = providers[args.provider]
          // 检查提供商是否存在
          if (!provider) {
            UI.error(`Provider not found: ${args.provider}`)
            return
          }

          // 打印指定提供商的模型
          printModels(args.provider, args.verbose)
          return
        }

        // 获取所有提供商 ID 并排序
        // opencode 提供商优先，其他按字母顺序
        const providerIDs = Object.keys(providers).sort((a, b) => {
          const aIsOpencode = a.startsWith("opencode")
          const bIsOpencode = b.startsWith("opencode")
          if (aIsOpencode && !bIsOpencode) return -1
          if (!aIsOpencode && bIsOpencode) return 1
          return a.localeCompare(b)
        })

        // 遍历并打印每个提供商的模型
        for (const providerID of providerIDs) {
          printModels(providerID, args.verbose)
        }
      },
    })
  },
})
