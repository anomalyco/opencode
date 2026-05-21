// Financial Harness Plugin — OpenCode + OmO 增强层
// 注册 Hook + 自定义工具

import type { Plugin, Hooks } from "@opencode-ai/plugin"

// ── Hooks ──────────────────────────────────────────────
import { writeGuardHook } from "./src/hooks/write-guard.js"
import { fileTrackerHook } from "./src/hooks/file-tracker.js"
import { pipelineInjectHook } from "./src/hooks/pipeline-inject.js"
import { stopGateHook } from "./src/hooks/stop-gate.js"
import { systemInjectHook } from "./src/hooks/system-inject.js"
import { sessionRestoreHook } from "./src/hooks/session-restore.js"

// ── Tools ──────────────────────────────────────────────
import { queryProgressTool } from "./src/tools/query-progress.js"
import { updateProgressTool } from "./src/tools/update-progress.js"
import { updateStepTool } from "./src/tools/update-step.js"
import { getTemplateTool } from "./src/tools/get-template.js"
import { listTemplatesTool } from "./src/tools/list-templates.js"

// ── 全局 Plugin 目录 ─────────────────────────────────
// Plugin 初始化时从 PluginInput.directory 保存，供 Hook 使用
export let pluginDirectory: string = ""
export let pluginWorktree: string = ""
export let pluginClient: any = undefined

// ── Server Plugin ─────────────────────────────────────
const server: Plugin = async (input) => {
  // 保存 directory 供 Hook 使用
  pluginDirectory = input.directory
  pluginWorktree = input.worktree
  pluginClient = input.client

  const hooks: Hooks = {
    ...writeGuardHook,
    ...fileTrackerHook,
    ...pipelineInjectHook,
    ...stopGateHook,
    ...systemInjectHook,
    ...sessionRestoreHook,

    tool: {
      "query-progress": queryProgressTool,
      "update-progress": updateProgressTool,
      "update-step": updateStepTool,
      "get-template": getTemplateTool,
      "list-templates": listTemplatesTool,
    },
  }

  return hooks
}

// OpenCode V1 Plugin 格式：default 导出 { id, server }
export default {
  id: "financial-harness",
  server,
}
