// pipeline-inject.ts — command.execute.before Hook
// 拦截 /prd /design /code /test /lingxi_harness 命令，注入 EXECUTION_PIPELINE

import path from "path"
import { getState, createEmptyStageProgress, sessions } from "../state.js"
import { buildPipeline, assemblePipeline } from "../pipeline/pipeline-builder.js"
import { lingxiHarnessInjectHandler } from "./lingxi-harness-inject.js"
import { pluginDirectory } from "../../index.js"

const VALID_MODS = ["prd", "design", "code", "test"] as const
type Mod = (typeof VALID_MODS)[number]

/** 原始 /prd /design /code /test 命令处理 */
async function pipelineInjectHandler(input: any, output: any): Promise<void> {
  const command: string = input.command ?? ""
  const sessionId: string = input.sessionID ?? input.session_id ?? ""
  const state = getState(sessionId)

  state.currentModule = command
  state.stageProgress = createEmptyStageProgress()
  state.noTemplate = false
  state.useLocalTemplate = false
  state.skipSpec = false
  state.pendingLocalRead = false
  state.pendingLocalSpec = false

  const directory: string = pluginDirectory || process.cwd()

  try {
    const harnessDir = path.join(directory, ".harness")
    const docsDir = path.join(directory, "docs")
    await Bun.write(path.join(harnessDir, ".keep"), "")
    await Bun.write(path.join(docsDir, ".keep"), "")

    const gitignorePath = path.join(directory, ".gitignore")
    const gitignoreFile = Bun.file(gitignorePath)
    const gitignore = await gitignoreFile.exists()
      ? await gitignoreFile.text()
      : ""
    if (!gitignore.includes(".harness/")) {
      await Bun.write(gitignorePath, gitignore.trimEnd() + "\n.harness/\n")
    }
  } catch {
    // 目录初始化失败不阻塞
  }

  // 直接调用 TS 版 Pipeline Builder（异步，支持用户定制化配置）
  const pipeline = await buildPipeline(command as Mod, {
    pluginDir: path.join(import.meta.dir, "..", ".."),
    projectDir: directory,
  })
  const pipelineText = assemblePipeline(pipeline)

  output.parts = output.parts ?? []
  output.parts.push({ type: "text", text: pipelineText })
}

/** 合并后的 command.execute.before Hook：通过 command 字段分发 */
export const pipelineInjectHook = {
  "command.execute.before": async (input: any, output: any) => {
    const command: string = input.command ?? ""
    if (command === "lingxi_harness" || command === "lingxi_code") {
      await lingxiHarnessInjectHandler(input, output)
    } else if (VALID_MODS.includes(command as Mod)) {
      await pipelineInjectHandler(input, output)
    }
  },
}
