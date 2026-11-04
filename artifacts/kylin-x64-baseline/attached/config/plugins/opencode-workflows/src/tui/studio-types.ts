/**
 * OpenCode Workflows —— Workflow Studio 共享纯逻辑（studio-types.ts，无 JSX，可独立测试）。
 *
 * `/workflows-studio` 把原先分散的 `list`（浏览/删类型）、`create`（新建）、`config`（改配置）、
 * `edit`（改结构）四条命令统一为**一个全屏入口**：进入后先选「意图」（5 选 1），再按意图选
 * 目标 workflow（新建除外），最后进入浏览详情 / 删除确认 / 向导。
 *
 * 本模块只承载**可纯函数化**的部分，供 `create-screen.tsx`（全屏壳层）与命令层共用：
 * - {@link STUDIO_INTENTS}：意图菜单项（顺序固定，破坏性的「删除」排最后）。
 * - {@link filterEntriesForIntent}：按意图过滤候选 workflow（含数据安全护栏）。
 * - {@link buildTypeDetail} / {@link sourceLabel}：只读类型详情文本（自 commands.ts 迁入）。
 *
 * 设计依据：docs/WF-Studio统一与命令收敛方案.md（评审稿）。
 */

import type { WorkflowRegistryEntry } from "../extension/extension-system"

// ============================================================================
// 意图（Studio Phase 0：意图菜单）
// ============================================================================

/**
 * Studio 五种意图：
 * - `browse`：只读浏览类型 + 看详情（候选=全部）；
 * - `create`：新建自定义 workflow（无需选目标）；
 * - `config`：改配置（候选=全部，含内置 default-*；只写 .config.json）；
 * - `edit-structure`：改结构（候选=有 draft 的用户自定义；重写脚本三文件）；
 * - `delete`：删除类型源文件（候选=用户自定义）。
 */
export type StudioIntentKey = "browse" | "create" | "config" | "edit-structure" | "delete"

/** 意图菜单单项元数据。 */
export interface StudioIntentItem {
  key: StudioIntentKey
  /** 菜单标题（含前导图标）。 */
  label: string
  /** 一句话说明（右侧描述）。 */
  description: string
  /** 是否需要先选一个目标 workflow（`create` 为 false，直接进新建向导）。 */
  needsTarget: boolean
  /** 是否为破坏性操作（影响是否二次确认 / 排序）。 */
  destructive: boolean
}

/**
 * 意图菜单项（**顺序固定**）：浏览 → 新建 → 改配置 → 改结构 → 删除。
 * 破坏性的「删除类型」固定排最后（评审决策）。
 */
export const STUDIO_INTENTS: readonly StudioIntentItem[] = [
  {
    key: "browse",
    label: "📖 浏览类型 / 查看详情",
    description: "只读查看已有 workflow 的声明与脚本路径",
    needsTarget: true,
    destructive: false,
  },
  {
    key: "create",
    label: "✨ 新建 workflow",
    description: "引导式 7 步创建自定义 workflow",
    needsTarget: false,
    destructive: false,
  },
  {
    key: "config",
    label: "⚙ 改配置",
    description: "给已有 workflow 换料/调产出：改资源路径与产出路径（不重建步骤；内置 default-* 的唯一定制入口）",
    needsTarget: true,
    destructive: false,
  },
  {
    key: "edit-structure",
    label: "🛠 改结构",
    description: "编辑自定义 workflow 的完整结构（重写脚本三文件）",
    needsTarget: true,
    destructive: false,
  },
  {
    key: "delete",
    label: "🗑 删除类型",
    description: "删除自定义 workflow 的源文件（不影响运行记录）",
    needsTarget: true,
    destructive: true,
  },
] as const

// ============================================================================
// 目标过滤（含数据安全护栏）
// ============================================================================

/**
 * 按意图过滤候选 workflow（**纯函数**，不修改入参，保持入参顺序）。
 *
 * 护栏（从旧命令层 handleConfig/handleEdit/confirmDeleteType 平移，一条不丢）：
 * - `browse` / `config`：全部类型（内置 + 用户自定义）；
 * - `edit-structure`：仅 `source==="user"` 且**有结构草稿**（`draftNames` 含其名）——内置
 *   与手写 `.mjs` 无 draft，若误入结构编辑会在 SUBMIT 时被向导生成脚本覆盖，故排除；
 * - `delete`：仅 `source==="user"`（删源文件，内置在包内不可删）；
 * - `create`：无需选目标，返回空数组。
 *
 * `edit-structure` 的 `draftNames` 由 screen 层先异步解析 `hasDraft(name)` 汇总后传入
 * （把异步 IO 留在壳层、纯逻辑保持同步可测）。未提供时 `edit-structure` 视为无候选。
 *
 * @param entries 已发现的全部类型。
 * @param intent  当前意图。
 * @param opts.draftNames `edit-structure` 用的「有 draft」名集合。
 */
export function filterEntriesForIntent(
  entries: readonly WorkflowRegistryEntry[],
  intent: StudioIntentKey,
  opts?: { draftNames?: ReadonlySet<string> },
): WorkflowRegistryEntry[] {
  switch (intent) {
    case "browse":
    case "config":
      return [...entries]
    case "delete":
      return entries.filter((e) => e.source === "user")
    case "edit-structure": {
      const draft = opts?.draftNames
      if (!draft) return []
      return entries.filter((e) => e.source === "user" && draft.has(e.name))
    }
    case "create":
      return []
  }
}

// ============================================================================
// 只读类型详情文本（自 commands.ts 迁入）
// ============================================================================

/** 来源标签：builtin → 内置；user → 用户自定义。 */
export function sourceLabel(source: WorkflowRegistryEntry["source"]): string {
  return source === "user" ? "用户自定义 (user)" : "内置 (builtin)"
}

/**
 * 构造 Workflow **类型**详情文本（**纯函数**），供 Studio 浏览模式的只读视图展示。
 *
 * 字段全部来自 `discoverWorkflows()` 的 {@link WorkflowRegistryEntry}（AST 静态提取的
 * meta + 发现阶段补充的 path/source），不含任何运行实例（run）信息：
 *
 * - **来源**：内置 / 用户自定义（{@link sourceLabel}）；
 * - **描述**：`description`（必有）；
 * - **适用场景**：`whenToUse` 存在才输出该段，缺省整段省略；
 * - **声明阶段**：列 `phases[].title`，有 `detail` 追加「 — <detail>」，有 `model` 追加
 *   「 · 模型 <model>」；`phases` 缺省或空时输出「（脚本未声明阶段）」。注意这是作者**静态
 *   声明**的阶段，非运行时真实步骤；
 * - **脚本路径**：内置与用户均输出**完整路径**；
 * - **下一步**：纯文字引导（不做交互跳转），并纠正斜杠命令正确用法。
 *
 * @param entry 已发现的 workflow 类型注册项。
 */
export function buildTypeDetail(entry: WorkflowRegistryEntry): string {
  const lines: string[] = []
  lines.push(`来源：${sourceLabel(entry.source)}`)
  lines.push("")
  lines.push("描述：")
  lines.push(entry.description || "（无描述）")

  const whenToUse = entry.whenToUse?.trim()
  if (whenToUse) {
    lines.push("")
    lines.push("适用场景：")
    lines.push(whenToUse)
  }

  lines.push("")
  const phases = entry.phases ?? []
  if (phases.length > 0) {
    lines.push(`声明阶段（${phases.length}）：`)
    for (const p of phases) {
      const detail = p.detail?.trim() ? ` — ${p.detail.trim()}` : ""
      const model = p.model?.trim() ? ` · 模型 ${p.model.trim()}` : ""
      lines.push(`  • ${p.title}${detail}${model}`)
    }
  } else {
    lines.push("声明阶段：（脚本未声明阶段）")
  }

  lines.push("")
  lines.push("脚本路径：")
  lines.push(entry.path)

  lines.push("")
  lines.push("下一步：单独输入 /workflows-run，在补全列表选中后选择本 workflow 并填写需求即可运行")

  return lines.join("\n")
}
