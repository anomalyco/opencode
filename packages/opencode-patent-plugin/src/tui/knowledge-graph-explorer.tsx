/**
 * 知识图谱探索器命令
 */

import type { TuiPluginApi } from "@yunpat/plugin/tui"

export function registerKGCommand(api: TuiPluginApi) {
  api.ui.dialog.replace(() => (
    <api.ui.DialogPrompt
      title="知识图谱探索"
      placeholder="输入概念（如：创造性、专利侵权）"
      onConfirm={(value: string) => {
        api.ui.dialog.clear()
        api.ui.toast({ variant: "info", message: `正在查询「${value}」的知识图谱...` })
      }}
      onCancel={() => api.ui.dialog.clear()}
    />
  ))
}
