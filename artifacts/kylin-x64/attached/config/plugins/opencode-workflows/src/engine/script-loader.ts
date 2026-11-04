/**
 * OpenCode Workflows —— 脚本加载器（ScriptLoader）。
 *
 * ScriptLoader 区分两阶段（R1.1）：
 * - **元数据提取阶段**（本文件，task 3.1）：通过**静态 AST 解析**读取
 *   `export const meta = {...}` 声明，**不执行脚本主体**，用于 `/workflow` 列表
 *   （R9.1）与自动发现（R14.4）。要求 meta 为**纯字面量**（不允许变量引用、函数调用、
 *   展开运算符、模板插值），使"纯字面量"约束**静态可判定**（R1.6、R2.1）。
 * - **执行阶段**（task 3.3 追加）：通过 Bun 原生 `import()` 动态加载并执行脚本主体，
 *   支持顶层 `await`（R1.2、R1.5）。
 *
 * 本文件仅实现元数据提取阶段所需的 {@link extractMeta} 与 {@link validateMeta}；
 * 执行阶段的 `load(scriptPath)` 由 **task 3.3** 在本文件末尾以纯增量方式追加，
 * 不影响本文件已导出的符号（见文件末尾 TODO）。
 *
 * ## "纯字面量"静态判定（非字面量检测）
 *
 * 使用 TypeScript 编译器 API（`typescript`，devDependency）将脚本源码解析为
 * `SourceFile`（仅解析、**不执行**），定位顶层 `export const meta` 声明，并要求其
 * 初始化器为**纯对象字面量**。{@link evalPureLiteral} 递归遍历该字面量的 AST，
 * 仅接受以下字面量节点：字符串/数字/布尔/null 字面量、无插值模板字符串
 * （`NoSubstitutionTemplateLiteral`，作为普通字符串）、数字字面量上的一元 `+`/`-`、
 * 数组字面量、对象字面量；遇到下列节点即判定为**非字面量**并抛出 `META_INVALID`：
 * - 变量引用（`Identifier` / 对象简写属性 `ShorthandPropertyAssignment`）
 * - 函数调用（`CallExpression`）
 * - 展开运算符（数组 `SpreadElement` / 对象 `SpreadAssignment`）
 * - 含插值的模板字符串（`TemplateExpression`，即 `` `...${x}...` ``）
 * - 其余一切非字面量表达式（二元运算、属性访问、计算属性名、方法/访问器等）
 *
 * > **模板字符串的取舍**：严格匹配"禁止模板插值"——**仅**拒绝带插值的
 * > `TemplateExpression`（`` `a${x}` ``）；不带插值的 `NoSubstitutionTemplateLiteral`
 * > （`` `abc` ``）与普通字符串字面量等价，**允许**并按普通字符串取值。
 *
 * @see .kiro/specs/opencode-workflows/design.md — Components and Interfaces / ScriptLoader
 * @see .kiro/specs/opencode-workflows/design.md — Property 1（Meta 验证完整性）
 * Requirements: 1.1, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5
 */

import { readFile } from "node:fs/promises"
import { resolve as resolvePath } from "node:path"
import { pathToFileURL } from "node:url"
import { randomUUID } from "node:crypto"
import { WorkflowError, isWorkflowError, type WorkflowErrorContext } from "../errors"
import type { PhaseDefinition, WorkflowMeta } from "../types"

// 便于消费方从 ScriptLoader 直接获取 meta 相关类型（单一来源仍为 ../types）。
export type { PhaseDefinition, WorkflowMeta } from "../types"

// ============================================================================
// typescript 懒加载（FIX-2perf / BUG-002：启动耗时优化）
// ============================================================================

/**
 * **为何懒加载（实测背景）**：`typescript` 包冷加载约 ~530ms。它**仅**被
 * {@link extractMeta} 用于「meta 须为纯字面量」的静态 AST 校验，而 extractMeta 只被
 * fire-and-forget 的 `discoverWorkflows()` 调用。若在模块顶层 `import ts from "typescript"`，
 * 会被 server 入口与 TUI 装配链**同步**拉入，使**每次进程启动**白白多付 ~530ms。
 *
 * 改为动态 `import("typescript")` 后，typescript 的加载成本转移到「首次 discover / 首次
 * 按名解析 workflow」时按需付（本就是异步后台动作，用户无感），启动路径不再触碰它。
 *
 * 类型引用一律用内联 `import("typescript").X` 形式（编译期擦除、**无运行时导入**），
 * 故本文件顶层不存在任何 `import ... from "typescript"` 静态导入。
 */
type TS = typeof import("typescript")
type TsExpression = import("typescript").Expression
type TsSourceFile = import("typescript").SourceFile
type TsPropertyName = import("typescript").PropertyName

/** typescript 模块单例 Promise（首次 {@link getTs} 调用时按需 import，之后复用）。 */
let _tsPromise: Promise<TS> | undefined

/**
 * 按需加载 typescript 并缓存模块单例（懒加载）。
 *
 * 兼容 CJS/ESM 互操作：优先取 `default`（部分打包形态下 ts 经 default 暴露），回退命名空间本身。
 */
function getTs(): Promise<TS> {
  if (!_tsPromise) {
    _tsPromise = import("typescript").then((m) => ((m as { default?: TS }).default ?? m) as TS)
  }
  return _tsPromise
}

// ============================================================================
// 字段约束常量（对应 R2.1 / R2.2 / R2.3）
// ============================================================================

/** `meta.name` 最大字符数（R2.1） */
const MAX_NAME_LENGTH = 64

/**
 * `meta.name` 合法字符集白名单（M2 安全修复）：以小写字母/数字起始，其后允许小写字母、
 * 数字、连字符、下划线。禁止 `.`/`/`/`\`/空白等字符——name 被拼进多处文件路径
 * （`scripts/<name>-wf_<runId>.mjs`、归档删除路径、Studio 配置/草稿文件名），无此约束时
 * `name="../../x"` 可逃逸 `scripts/` 目录。是 Studio `validateName`（纯 kebab-case）的超集，
 * 故 Studio 产出的合法名与全部现有内置 workflow 名（如 `default-prd`）均通过。
 */
const NAME_CHARSET_RE = /^[a-z0-9][a-z0-9_-]*$/
/** `meta.description` 最大字符数（R2.1） */
const MAX_DESCRIPTION_LENGTH = 256
/** `meta.whenToUse` 最大字符数（R2.3） */
const MAX_WHEN_TO_USE_LENGTH = 512
/** `meta.outputName` 最大字符数（默认落盘友好文件名，不含扩展名） */
const MAX_OUTPUT_NAME_LENGTH = 64
/**
 * `meta.outputName` 路径安全黑名单：禁含路径分隔符 `/`、`\` 与父目录引用 `..`。
 * outputName 会被拼进 `docs/<outputName>.md`，无此约束时可逃逸 docs 目录（如 `../../x`）。
 * 允许中文、字母、数字、空格及常见标点（不限定白名单字符集，仅排除危险序列）。
 */
const OUTPUT_NAME_FORBIDDEN_RE = /[/\\]|\.\./
/** `meta.phases` 最大元素数（R2.2） */
const MAX_PHASES_LENGTH = 20

// ============================================================================
// 公开接口形状（与 design.md「ScriptLoader」一致）
// ============================================================================

/**
 * 执行阶段加载得到的脚本对象。
 *
 * 注：`execute` 的上下文类型在 design.md 标注为 `WorkflowContext`，该类型由
 * Orchestration_API（task 11.3）定义；在其就绪前此处以 `unknown` 占位，
 * task 3.3 实现 `load()` 时可按需收窄。
 */
export interface LoadedScript {
  /** 经 {@link validateMeta} 校验后的元数据 */
  meta: WorkflowMeta
  /** 脚本主体（在 async 上下文中执行，支持顶层 await） */
  execute: (context: unknown) => Promise<unknown>
  /** 脚本原始内容 */
  source: string
  /** 脚本文件路径 */
  path: string
}

/**
 * 脚本加载器接口（design.md「ScriptLoader」）。
 *
 * 本文件以**独立命名函数**形式实现 {@link extractMeta} 与 {@link validateMeta}；
 * `load()` 由 task 3.3 追加。该接口作为类型契约导出，便于上层按接口形状装配。
 */
export interface ScriptLoader {
  /** 元数据提取阶段：静态 AST 解析提取并验证 meta，不执行脚本主体 */
  extractMeta(scriptPath: string): Promise<WorkflowMeta>
  /** 执行阶段：通过 import() 动态加载脚本主体（task 3.3 实现） */
  load(scriptPath: string): Promise<LoadedScript>
  /** 验证 meta（字段约束）；纯字面量约束由 extractMeta 经 AST 静态判定 */
  validateMeta(meta: unknown): WorkflowMeta
}

// ============================================================================
// 错误构造辅助
// ============================================================================

/** 构造一个 `META_INVALID` 错误，附带定位上下文（字段名 / phases 索引 / 文件路径等）。 */
function metaInvalid(message: string, context?: WorkflowErrorContext): WorkflowError {
  return new WorkflowError("META_INVALID", message, context)
}

// ============================================================================
// validateMeta —— 运行时值的字段约束校验（不做 AST 判定）
// ============================================================================

/**
 * 校验 meta **字段约束**并返回类型收窄后的 {@link WorkflowMeta}。
 *
 * 本函数对**运行时对象值**做校验，不感知其是否来自纯字面量——"纯字面量"为静态 AST
 * 约束，由 {@link extractMeta} 在提取阶段强制（见文件头注释）。因此本函数可被
 * 属性测试（task 3.2）独立调用，仅围绕字段约束生成输入。
 *
 * 校验规则（R2.1-R2.5）：
 * - `name`：必需，string，非空，≤64 字符；
 * - `description`：必需，string，非空，≤256 字符；
 * - `whenToUse`：可选；若存在必须为 string 且 ≤512 字符（允许空字符串）；
 * - `phases`：可选；若存在必须为数组且 ≤20 个元素，每个元素须为对象且含非空 string
 *   `title`（`detail`/`model` 若存在须为 string）。
 *
 * 任一约束不满足时抛出 `META_INVALID`，错误信息指明**具体字段名**或
 * **无效的 phases 元素索引**。
 *
 * @param meta 待校验的 meta 值（任意类型）。
 * @param contextBase 附加到错误上下文的基础字段（如 `filePath`）；供 extractMeta 透传。
 * @returns 校验通过的 {@link WorkflowMeta}。
 * @throws {WorkflowError} 代码为 `META_INVALID`，附带 `field`/`phaseIndex` 等定位信息。
 */
export function validateMeta(meta: unknown, contextBase: WorkflowErrorContext = {}): WorkflowMeta {
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
    throw metaInvalid("meta 必须为对象", { ...contextBase, field: "meta" })
  }

  const obj = meta as Record<string, unknown>

  // ---- name（必需，非空，≤64）----
  const name = obj.name
  if (typeof name !== "string") {
    throw metaInvalid("meta.name 缺失或不是字符串（必需）", { ...contextBase, field: "name" })
  }
  if (name.length === 0) {
    throw metaInvalid("meta.name 不能为空字符串", { ...contextBase, field: "name" })
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw metaInvalid(`meta.name 超过最大长度 ${MAX_NAME_LENGTH}（实际 ${name.length}）`, {
      ...contextBase,
      field: "name",
    })
  }
  // 字符集白名单（M2 安全修复）：阻断 `.`/`/`/`\` 等路径逃逸字符，防止 name 拼进文件路径时
  // 逃逸受控目录（如 "../../x"）。
  if (!NAME_CHARSET_RE.test(name)) {
    throw metaInvalid(
      `meta.name 含非法字符：仅允许以小写字母/数字起始，其后为小写字母、数字、连字符或下划线（实际 ${JSON.stringify(name)}）`,
      { ...contextBase, field: "name" },
    )
  }

  // ---- description（必需，非空，≤256）----
  const description = obj.description
  if (typeof description !== "string") {
    throw metaInvalid("meta.description 缺失或不是字符串（必需）", { ...contextBase, field: "description" })
  }
  if (description.length === 0) {
    throw metaInvalid("meta.description 不能为空字符串", { ...contextBase, field: "description" })
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw metaInvalid(
      `meta.description 超过最大长度 ${MAX_DESCRIPTION_LENGTH}（实际 ${description.length}）`,
      { ...contextBase, field: "description" },
    )
  }

  // ---- whenToUse（可选，≤512）----
  const whenToUse = obj.whenToUse
  if (whenToUse !== undefined) {
    if (typeof whenToUse !== "string") {
      throw metaInvalid("meta.whenToUse 必须为字符串", { ...contextBase, field: "whenToUse" })
    }
    if (whenToUse.length > MAX_WHEN_TO_USE_LENGTH) {
      throw metaInvalid(
        `meta.whenToUse 超过最大长度 ${MAX_WHEN_TO_USE_LENGTH}（实际 ${whenToUse.length}）`,
        { ...contextBase, field: "whenToUse" },
      )
    }
  }

  // ---- outputName（可选，≤64，非空白，禁含路径分隔符 / \ 与 ..）----
  const outputName = obj.outputName
  if (outputName !== undefined) {
    if (typeof outputName !== "string") {
      throw metaInvalid("meta.outputName 必须为字符串", { ...contextBase, field: "outputName" })
    }
    if (outputName.trim().length === 0) {
      throw metaInvalid("meta.outputName 不能为空或纯空白", { ...contextBase, field: "outputName" })
    }
    if (outputName.length > MAX_OUTPUT_NAME_LENGTH) {
      throw metaInvalid(
        `meta.outputName 超过最大长度 ${MAX_OUTPUT_NAME_LENGTH}（实际 ${outputName.length}）`,
        { ...contextBase, field: "outputName" },
      )
    }
    if (OUTPUT_NAME_FORBIDDEN_RE.test(outputName)) {
      throw metaInvalid(
        `meta.outputName 含非法字符：禁含路径分隔符 / \\ 与 ..（实际 ${JSON.stringify(outputName)}）`,
        { ...contextBase, field: "outputName" },
      )
    }
  }

  // ---- phases（可选，≤20 元素，每元素含非空 title）----
  const phases = obj.phases
  let validatedPhases: PhaseDefinition[] | undefined
  if (phases !== undefined) {
    if (!Array.isArray(phases)) {
      throw metaInvalid("meta.phases 必须为数组", { ...contextBase, field: "phases" })
    }
    if (phases.length > MAX_PHASES_LENGTH) {
      throw metaInvalid(`meta.phases 元素数超过上限 ${MAX_PHASES_LENGTH}（实际 ${phases.length}）`, {
        ...contextBase,
        field: "phases",
      })
    }
    validatedPhases = phases.map((element, index) => validatePhase(element, index, contextBase))
  }

  const result: WorkflowMeta = { name, description }
  if (whenToUse !== undefined) result.whenToUse = whenToUse as string
  if (outputName !== undefined) result.outputName = outputName as string
  if (validatedPhases !== undefined) result.phases = validatedPhases
  return result
}

/** 校验单个 phases 元素（含非空 title），失败时错误指明 phases 元素索引（R2.5）。 */
function validatePhase(element: unknown, index: number, contextBase: WorkflowErrorContext): PhaseDefinition {
  if (typeof element !== "object" || element === null || Array.isArray(element)) {
    throw metaInvalid(`meta.phases[${index}] 必须为对象`, { ...contextBase, field: "phases", phaseIndex: index })
  }
  const el = element as Record<string, unknown>

  const title = el.title
  if (typeof title !== "string") {
    throw metaInvalid(`meta.phases[${index}].title 缺失或不是字符串（必需）`, {
      ...contextBase,
      field: "phases",
      phaseIndex: index,
    })
  }
  if (title.length === 0) {
    throw metaInvalid(`meta.phases[${index}].title 不能为空字符串`, {
      ...contextBase,
      field: "phases",
      phaseIndex: index,
    })
  }

  const phase: PhaseDefinition = { title }

  if (el.detail !== undefined) {
    if (typeof el.detail !== "string") {
      throw metaInvalid(`meta.phases[${index}].detail 必须为字符串`, {
        ...contextBase,
        field: "phases",
        phaseIndex: index,
      })
    }
    phase.detail = el.detail
  }

  if (el.model !== undefined) {
    if (typeof el.model !== "string") {
      throw metaInvalid(`meta.phases[${index}].model 必须为字符串`, {
        ...contextBase,
        field: "phases",
        phaseIndex: index,
      })
    }
    phase.model = el.model
  }

  return phase
}

// ============================================================================
// 静态 AST 提取 —— 纯字面量判定（非字面量检测）
// ============================================================================

/**
 * 在 `SourceFile` 顶层定位 `export const meta = <initializer>` 的初始化器表达式。
 *
 * 仅匹配**导出的**变量声明（`export const/let/var meta = ...`）；未导出的 meta
 * 无法被 `import()` 读取，视为未声明。返回初始化器表达式；未找到则返回 undefined。
 */
function findMetaInitializer(ts: TS, sourceFile: TsSourceFile): TsExpression | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    const modifiers = ts.getModifiers(statement)
    const isExported = modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
    if (!isExported) continue
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === "meta") {
        return declaration.initializer
      }
    }
  }
  return undefined
}

/**
 * 递归将一个**纯字面量** AST 表达式求值为对应的 JS 值；遇到任何非字面量节点即抛出
 * `META_INVALID`，错误信息指明该节点在 meta 中的字段路径与节点类型。
 *
 * @param node 当前 AST 表达式节点。
 * @param fieldPath 该节点在 meta 中的字段路径（如 `meta.phases[0].title`），用于定位错误。
 * @param ctxBase 附加到错误上下文的基础字段（如 `filePath`）。
 */
function evalPureLiteral(ts: TS, node: TsExpression, fieldPath: string, ctxBase: WorkflowErrorContext): unknown {
  // 透明展开括号表达式：`("a")` 仍为字面量。
  if (ts.isParenthesizedExpression(node)) {
    return evalPureLiteral(ts, node.expression, fieldPath, ctxBase)
  }

  // 字符串字面量。
  if (ts.isStringLiteral(node)) return node.text

  // 无插值模板字符串（`` `abc` ``）等价普通字符串 —— 允许（仅拒绝带插值的 TemplateExpression）。
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text

  // 数字字面量。
  if (ts.isNumericLiteral(node)) return Number(node.text)

  // 布尔 / null 关键字字面量。
  switch (node.kind) {
    case ts.SyntaxKind.TrueKeyword:
      return true
    case ts.SyntaxKind.FalseKeyword:
      return false
    case ts.SyntaxKind.NullKeyword:
      return null
    default:
      break
  }

  // 数字字面量上的一元 +/-（如 `-1`、`+2`）。
  if (
    ts.isPrefixUnaryExpression(node) &&
    (node.operator === ts.SyntaxKind.MinusToken || node.operator === ts.SyntaxKind.PlusToken) &&
    ts.isNumericLiteral(node.operand)
  ) {
    const numeric = Number(node.operand.text)
    return node.operator === ts.SyntaxKind.MinusToken ? -numeric : numeric
  }

  // 数组字面量：逐元素递归；展开元素（...x）禁止。
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((element, index) => {
      if (ts.isSpreadElement(element)) {
        throw metaInvalid(`${fieldPath}[${index}] 含展开运算符（禁止，meta 须为纯字面量）`, {
          ...ctxBase,
          fieldPath: `${fieldPath}[${index}]`,
        })
      }
      return evalPureLiteral(ts, element, `${fieldPath}[${index}]`, ctxBase)
    })
  }

  // 对象字面量：逐属性递归；展开、简写、方法/访问器、计算属性名均禁止。
  if (ts.isObjectLiteralExpression(node)) {
    const result: Record<string, unknown> = {}
    for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) {
        throw metaInvalid(`${fieldPath} 含展开运算符（禁止，meta 须为纯字面量）`, {
          ...ctxBase,
          fieldPath,
        })
      }
      if (ts.isShorthandPropertyAssignment(property)) {
        throw metaInvalid(
          `${fieldPath}.${property.name.text} 为简写属性（等价变量引用，禁止，meta 须为纯字面量）`,
          { ...ctxBase, fieldPath: `${fieldPath}.${property.name.text}` },
        )
      }
      if (!ts.isPropertyAssignment(property)) {
        // 方法、get/set 访问器等。
        throw metaInvalid(`${fieldPath} 含方法或访问器属性（禁止，meta 须为纯字面量）`, {
          ...ctxBase,
          fieldPath,
        })
      }
      const key = literalPropertyName(ts, property.name, fieldPath, ctxBase)
      result[key] = evalPureLiteral(ts, property.initializer, `${fieldPath}.${key}`, ctxBase)
    }
    return result
  }

  // 其余一切：变量引用（Identifier）、函数调用（CallExpression）、带插值模板
  // （TemplateExpression）、二元运算、属性访问等 —— 均为非字面量。
  throw metaInvalid(
    `${fieldPath} 不是纯字面量（含变量引用/函数调用/模板插值等不可静态求值的表达式，节点类型 ${ts.SyntaxKind[node.kind]}）`,
    { ...ctxBase, fieldPath, nodeKind: ts.SyntaxKind[node.kind] },
  )
}

/** 提取对象字面量属性的字面量键名；计算属性名（含非字面量）一律禁止。 */
function literalPropertyName(ts: TS, name: TsPropertyName, fieldPath: string, ctxBase: WorkflowErrorContext): string {
  if (ts.isIdentifier(name)) return name.text
  if (ts.isStringLiteral(name)) return name.text
  if (ts.isNumericLiteral(name)) return name.text
  // ComputedPropertyName、PrivateIdentifier 等。
  throw metaInvalid(`${fieldPath} 含计算属性名或非法属性名（禁止，meta 须为纯字面量）`, {
    ...ctxBase,
    fieldPath,
  })
}

// ============================================================================
// extractMeta —— 元数据提取阶段入口
// ============================================================================

/**
 * 元数据提取阶段：读取脚本文件，**静态 AST 解析** `export const meta` 声明（**不执行
 * 脚本主体**），强制其为纯字面量，再经 {@link validateMeta} 校验字段约束并返回。
 *
 * 失败语义：
 * - 文件不存在 / 不可读 → `SCRIPT_NOT_FOUND`（附带 `filePath`）；
 * - 未找到 `export const meta` 声明、meta 非对象字面量、含非字面量、或字段约束不满足
 *   → `META_INVALID`（附带定位上下文与 `filePath`）。
 *
 * @param scriptPath 脚本文件绝对路径或相对路径。
 * @returns 校验通过的 {@link WorkflowMeta}。
 */
export async function extractMeta(scriptPath: string): Promise<WorkflowMeta> {
  let source: string
  try {
    source = await readFile(scriptPath, "utf8")
  } catch (cause) {
    throw new WorkflowError("SCRIPT_NOT_FOUND", `脚本文件不存在或不可读：${scriptPath}`, {
      filePath: scriptPath,
      cause: cause instanceof Error ? cause.message : String(cause),
    })
  }

  // 按需加载 typescript（懒加载，FIX-2perf）：仅静态 AST 校验阶段需要，避免启动期同步加载。
  const ts = await getTs()

  // 仅解析、不执行；setParentNodes=true 便于节点遍历；按 JS 脚本解析（.mjs）。
  const sourceFile = ts.createSourceFile(scriptPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)

  const initializer = findMetaInitializer(ts, sourceFile)
  if (initializer === undefined) {
    throw metaInvalid("未找到 export const meta 声明（meta 必需）", { filePath: scriptPath, field: "meta" })
  }

  if (!ts.isObjectLiteralExpression(initializer)) {
    throw metaInvalid("meta 必须为对象字面量（不允许变量引用、函数调用、展开运算符或模板插值）", {
      filePath: scriptPath,
      field: "meta",
      nodeKind: ts.SyntaxKind[initializer.kind],
    })
  }

  // 纯字面量静态判定 + 求值为 JS 对象。
  const value = evalPureLiteral(ts, initializer, "meta", { filePath: scriptPath })

  // 字段约束校验（透传 filePath 以便错误定位到具体文件）。
  try {
    return validateMeta(value, { filePath: scriptPath })
  } catch (error) {
    // validateMeta 已携带 field/phaseIndex/filePath；原样上抛即可。
    if (isWorkflowError(error)) throw error
    throw error
  }
}

// ============================================================================
// load —— 执行阶段加载（task 3.3）
// ============================================================================

/**
 * 从动态导入的模块命名空间中解析出可执行的脚本主体 `execute`。
 *
 * 解析约定（与 fixtures/valid-workflow.mjs 一致）：
 * 1. 优先取 `default` 导出——若其为函数（如 `export default async function execute(ctx){...}`），
 *    则它即为脚本主体；
 * 2. 否则取命名导出 `execute`——若其为函数（如 `export async function execute(ctx){...}`），
 *    则它即为脚本主体；
 * 3. 二者皆非函数则视为缺失可执行主体，抛出 `SCRIPT_SYNTAX_ERROR`。
 *
 * @param moduleNamespace import() 返回的模块命名空间对象。
 * @param scriptPath 脚本路径，仅用于错误定位。
 */
function resolveExecute(
  moduleNamespace: Record<string, unknown>,
  scriptPath: string,
): (context: unknown) => Promise<unknown> {
  const defaultExport = moduleNamespace.default
  if (typeof defaultExport === "function") {
    return defaultExport as (context: unknown) => Promise<unknown>
  }

  const namedExecute = moduleNamespace.execute
  if (typeof namedExecute === "function") {
    return namedExecute as (context: unknown) => Promise<unknown>
  }

  throw new WorkflowError(
    "SCRIPT_SYNTAX_ERROR",
    "脚本缺少可执行主体：default 导出须为函数，或须提供名为 execute 的函数导出",
    { filePath: scriptPath, reason: "missing execute body" },
  )
}

/**
 * 执行阶段：通过 Bun 原生 `import()` 动态加载脚本模块并返回 {@link LoadedScript}。
 *
 * 与 {@link extractMeta} 的「仅静态 AST 解析、不执行主体」不同，本函数**会执行**模块的
 * 顶层代码（求值 `export const meta`、定义 `execute` 等）。由于 `import()` 在 async 上下文中
 * await 模块求值，脚本天然支持**顶层 `await`**（R1.5）——无需任何特殊处理。
 *
 * 流程：
 * 1. 读取源码文本（用于 {@link LoadedScript.source} 字段）。读取失败（文件不存在/不可读）
 *    → `SCRIPT_NOT_FOUND`（附带 `filePath`，R1.3）。
 * 2. 将路径规范化为绝对路径并经 `pathToFileURL()` 转为 `file://` URL（Windows 下避免盘符路径
 *    被 `import()` 误判为裸模块说明符），追加 cache-busting 查询（`?t=<uuid>`）以规避模块缓存
 *    陈旧——确保同一脚本在多次运行（含 resume 重跑）间被重新求值而非返回缓存模块实例。
 * 3. `await import(href)` 动态加载。语法错误 / 求值期抛错 / 加载失败 → `SCRIPT_SYNTAX_ERROR`
 *    （附带 `reason`，R1.4）。
 * 4. 从模块命名空间解析 `execute`（见 {@link resolveExecute}）；缺失 → `SCRIPT_SYNTAX_ERROR`。
 * 5. 校验模块的 `meta` 导出（经 {@link validateMeta} 做字段约束校验）。注：纯字面量约束由
 *    {@link extractMeta} 在发现阶段经静态 AST 强制（R1.6）；执行阶段此处仅复核字段约束。
 *
 * @param scriptPath 脚本文件绝对路径或相对路径。
 * @returns {@link LoadedScript}：`{ meta（已校验）, execute, source, path: scriptPath }`。
 * @throws {WorkflowError} `SCRIPT_NOT_FOUND`（读取失败）/ `SCRIPT_SYNTAX_ERROR`（加载失败或缺主体）
 *   / `META_INVALID`（meta 字段约束不满足）。
 */
export async function load(scriptPath: string): Promise<LoadedScript> {
  // ---- 1. 读取源码文本（文件不存在/不可读 → SCRIPT_NOT_FOUND，R1.3）----
  let source: string
  try {
    source = await readFile(scriptPath, "utf8")
  } catch (cause) {
    throw new WorkflowError("SCRIPT_NOT_FOUND", `脚本文件不存在或不可读：${scriptPath}`, {
      filePath: scriptPath,
      cause: cause instanceof Error ? cause.message : String(cause),
    })
  }

  // ---- 2. 规范化为 file:// URL + cache-busting，避免 Windows 路径与模块缓存陈旧问题 ----
  const absolutePath = resolvePath(scriptPath)
  const importHref = `${pathToFileURL(absolutePath).href}?t=${randomUUID()}`

  // ---- 3. 动态 import()（支持顶层 await，R1.2/R1.5）；失败 → SCRIPT_SYNTAX_ERROR（R1.4）----
  let moduleNamespace: Record<string, unknown>
  try {
    moduleNamespace = (await import(importHref)) as Record<string, unknown>
  } catch (cause) {
    // 已是 WorkflowError（如 resolveExecute 在顶层 await 路径中复抛）时原样上抛。
    if (isWorkflowError(cause)) throw cause
    // message 拼入原始错误（bun 的编译期错误质量高、含变量名与定位，如 const 重复赋值
    // "This assignment will throw because \"x\" is a constant"）——笼统串无诊断价值，
    // 用户在 TUI 只看得到 message，原始错误必须直达。
    const rawReason = cause instanceof Error ? cause.message : String(cause)
    throw new WorkflowError(
      "SCRIPT_SYNTAX_ERROR",
      `脚本加载失败（语法错误或导入异常）：${scriptPath}——${rawReason}`,
      { filePath: scriptPath, reason: rawReason },
    )
  }

  // ---- 4. 解析 execute 主体（缺失 → SCRIPT_SYNTAX_ERROR）----
  const execute = resolveExecute(moduleNamespace, scriptPath)

  // ---- 5. 校验 meta 字段约束（纯字面量约束已由 extractMeta 在发现阶段强制，R1.6）----
  const meta = validateMeta(moduleNamespace.meta, { filePath: scriptPath })

  return { meta, execute, source, path: scriptPath }
}

// ============================================================================
// createScriptLoader —— 装配为 ScriptLoader 接口对象
// ============================================================================

/**
 * 将独立函数 {@link extractMeta} / {@link load} / {@link validateMeta} 装配为符合
 * {@link ScriptLoader} 接口形状的对象，便于下游（如 WorkflowEngine，task 13.1）按接口契约消费。
 *
 * 注：标准独立导出（{@link extractMeta} / {@link load} / {@link validateMeta}）仍保留，
 * 二者可按需选用。
 */
export function createScriptLoader(): ScriptLoader {
  return { extractMeta, load, validateMeta: (meta: unknown) => validateMeta(meta) }
}
