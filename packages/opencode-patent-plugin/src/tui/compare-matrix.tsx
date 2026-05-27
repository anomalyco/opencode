/**
 * 专利对比矩阵命令
 */

import type { TuiPluginApi } from "@yunpat/plugin/tui"

export function registerCompareCommand(api: TuiPluginApi) {
  api.ui.dialog.replace(() => (
    <api.ui.DialogAlert
      title="专利对比矩阵"
      message="选择多篇专利进行特征对比分析（开发中）"
      onConfirm={() => api.ui.dialog.clear()}
    />
  ))
}
