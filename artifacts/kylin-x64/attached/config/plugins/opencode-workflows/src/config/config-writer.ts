/**
 * OpenCode Workflows —— ConfigWriter（单 workflow 配置序列化 + 落盘端口，新增）。
 *
 * workflow-create-studio（能力域 D）：把配置编辑器草稿（`RawConfigBlock`）序列化为
 * `<name>.config.json` 文本（纯函数 {@link renderConfigJson}），并定义落盘端口契约
 * {@link ConfigWriter}（真实实现由 `tui.tsx` 注入，与 `writeUserWorkflowToGlobalDir`
 * 同语义：原子写、失败清理）。
 *
 * 设计决策（避免给 loader 增加 JSONC 解析负担）：声明了但未填真实路径的资源类别，
 * `resources.<类别>` 写占位值 `"none"`（R12.3），补填说明写入并列的 `resourceLabels.<类别>`，
 * 这样产物是**合法 JSON**，loader 零额外解析即可回读（该类别求值为空数组）。
 *
 * 序列化稳定性：`resources` / `resourceLabels` 按类别名排序输出（稳定 key 序），便于
 * diff 与往返一致；产物经 `JSON.stringify(obj, null, 2)` 得稳定缩进。
 *
 * @see .kiro/specs/workflow-create-studio/design.md — Components and Interfaces / 4
 * Requirements: 12.2, 12.3, 13.4
 */

import type { ConfigValue, RawConfigBlock } from "../types"

/**
 * 落盘端口契约：把内容写入 `<globalDir>/<fileName>`，返回绝对路径。
 *
 * 真实实现由 `tui.tsx` 注入（`writeUserConfigToGlobalDir`，与 `writeUserWorkflow`
 * 同语义——mkdir -p + 写临时文件 + 原子 rename + 失败清理；以 reject 报错）。
 */
export type ConfigWriter = (fileName: string, content: string) => Promise<string>

/**
 * 把 {@link RawConfigBlock} 序列化为 `<name>.config.json` 文本（纯函数，纯 per-phase）。
 *
 * 规则（Phase 3 重写，纯 per-phase JSON，无顶层别名镜像）：
 * - `resources`：嵌套字典，阶段键排序 + 阶段内类别键排序。
 * - `resourceLabels`：嵌套字典，阶段键排序 + 阶段内类别键排序。
 * - `output_path`：字典，按阶段名排序。
 * - `max_review_rounds`：字典，按阶段名排序。
 * - 产物为合法 JSON，末尾加换行符。
 * - 已声明但空路径的类别写占位 "none"（R12.3）。
 *
 * @param block 配置草稿（通常由 create-state 的 toConfigBlock 投影而来）。
 * @param opts.declaredButEmpty 已声明但空路径的类别名列表（需写占位 "none"）。
 * Requirements: P3.1, P3.2, P3.3, 12.3
 */
export function renderConfigJson(block: RawConfigBlock, opts?: { declaredButEmpty?: string[] }): string {
  const obj: Record<string, unknown> = {}
  const emptySet = new Set(opts?.declaredButEmpty ?? [])

  // resources: 嵌套字典，递归排序（阶段键排序 + 阶段内类别键排序）
  // 已声明但空路径的类别写占位 "none"（R12.3）
  if (block.resources && typeof block.resources === "object" && !Array.isArray(block.resources)) {
    const resources: Record<string, Record<string, ConfigValue>> = {}
    for (const phase of Object.keys(block.resources).sort()) {
      const categories = block.resources[phase]
      if (categories && typeof categories === "object" && !Array.isArray(categories)) {
        const phaseRes: Record<string, ConfigValue> = {}
        for (const category of Object.keys(categories).sort()) {
          // 如果在 declaredButEmpty 列表中，写 "none"；否则原样写入
          if (emptySet.has(category)) {
            phaseRes[category] = "none"
          } else {
            phaseRes[category] = categories[category]
          }
        }
        if (Object.keys(phaseRes).length > 0) resources[phase] = phaseRes
      }
    }
    if (Object.keys(resources).length > 0) obj.resources = resources
  }

  // resourceLabels: 嵌套字典，递归排序
  if (block.resourceLabels && typeof block.resourceLabels === "object" && !Array.isArray(block.resourceLabels)) {
    const resourceLabels: Record<string, Record<string, string>> = {}
    for (const phase of Object.keys(block.resourceLabels).sort()) {
      const labels = block.resourceLabels[phase]
      if (labels && typeof labels === "object" && !Array.isArray(labels)) {
        const phaseLabels: Record<string, string> = {}
        for (const category of Object.keys(labels).sort()) {
          if (typeof labels[category] === "string") {
            phaseLabels[category] = labels[category]
          }
        }
        if (Object.keys(phaseLabels).length > 0) resourceLabels[phase] = phaseLabels
      }
    }
    if (Object.keys(resourceLabels).length > 0) obj.resourceLabels = resourceLabels
  }

  // output_path: 字典，按阶段排序
  if (
    block.output_path &&
    typeof block.output_path === "object" &&
    !Array.isArray(block.output_path) &&
    Object.keys(block.output_path).length > 0
  ) {
    obj.output_path = sortedObject(block.output_path as Record<string, string>)
  }

  // max_review_rounds: 字典，按阶段排序
  if (
    block.max_review_rounds &&
    typeof block.max_review_rounds === "object" &&
    !Array.isArray(block.max_review_rounds) &&
    Object.keys(block.max_review_rounds).length > 0
  ) {
    obj.max_review_rounds = sortedObject(block.max_review_rounds as Record<string, number>)
  }

  return JSON.stringify(obj, null, 2) // 不加末尾换行符，保持与 JSON.stringify 一致
}

/** 返回按 key 排序后的浅拷贝对象（稳定 key 序）。 */
function sortedObject<T>(o: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {}
  for (const k of Object.keys(o).sort()) out[k] = o[k]
  return out
}
