/**
 * OpenCode Workflows —— 动态 workflow 脚本契约校验器（workflow-create-validator）。
 *
 * `/workflows-create` 工具的 `execute` 在写盘前调用本校验器，对模型生成的脚本内容做
 * **高精度静态契约检查**（正则，少误报），拦住会导致「能跑但功能失效」的隐蔽违约。
 *
 * 校验的契约（与 `.opencode/command/workflows-create.md` 的「Must Follow Contracts」对齐）：
 * - **C1 配置读取路径**：读资源须用 `ctx.config.resources?.["..."]`，不得用扁平
 *   `config.template/rules/review`（原 code-migrate bug：`config` 未定义 → 资源永远空）。
 * - **C2 审查轮次配置驱动**：门控 `maxRounds` 须读 `ctx.config.maxReviewRounds`（或
 *   per-phase 的 `maxReviewRoundsByPhase`），不得硬编码数字字面量（用户无法调整）。
 * - **C4 helper 完整性**：使用 `runStopGate`/`runMultiGate` 则必须内联 `str`/`parseVerdict`/
 *   `formatIssues` 与对应门控函数定义（否则运行时 `xxx is not defined`）。
 *
 * 不在本校验器内（职责切分）：
 * - **C3 ctx.writeFile 落盘**：workflow 未必落盘，强查会误报；落盘正确性由人工/运行验证。
 * - **C5 meta 纯字面量**：由 `ScriptLoader.extractMeta` 在写盘后做权威 AST 校验（静态可判定），
 *   本正则校验器不重复实现 AST 逻辑。
 *
 * 纯函数、无副作用、不抛。
 */

// typescript 改为懒加载（FIX-2perf / BUG-002）：见下方 getTs() 说明。本文件不再静态 import。

/**
 * **为何懒加载（FIX-2perf / BUG-002）**：`typescript` 包冷加载约 ~530ms。本文件仅
 * `firstSyntaxError()`（C0 语法契约校验）用到 ts，而该校验只在 `/workflows-create` 工具
 * **执行时**才需要。若在模块顶层 `import ts from "typescript"`，会被 `index.ts` 经
 * `workflow-create.ts` 的静态 import 链**同步**拉入，使**每次进程启动**白白多付 ~530ms。
 * 改为动态 `import("typescript")` + 单例缓存后，启动路径不再触碰 typescript。
 *
 * 类型引用用内联 `import("typescript").X` 形式（编译期擦除、无运行时导入）。
 */
type TS = typeof import("typescript")
type TsDiagnosticWithLocation = import("typescript").DiagnosticWithLocation

let _tsPromise: Promise<TS> | undefined

/** 按需加载 typescript 并缓存模块单例（懒加载）。 */
function getTs(): Promise<TS> {
  if (!_tsPromise) {
    _tsPromise = import("typescript").then((m) => ((m as { default?: TS }).default ?? m) as TS)
  }
  return _tsPromise
}

/** 单条契约违约。 */
export interface ContractViolation {
  /** 契约编号（1/2/4 或 "C6"/"C7"/"C8"/"C9"/"C10"）。 */
  contract: number | string
  /** 契约名（人类可读）。 */
  name: string
  /** 违约细节（指出问题）。 */
  detail: string
  /** 正确写法示例（供模型修正）。 */
  fix: string
}

/** 校验结果。 */
export interface ValidationResult {
  passed: boolean
  violations: ContractViolation[]
}

/**
 * 扁平资源访问（违约 C1）：`config.template`/`config.rules`/`config.review`，
 * 且**不以 `ctx.` 紧邻在前**（排除合法的顶层别名 `ctx.config.template`）。
 * 负向后行断言排除 `ctx.config.template` 这类向后兼容别名。
 */
const FLAT_CONFIG_RE = /(?<!ctx\.)\bconfig\.(?:template|rules|review)\b/

/** 门控调用存在性（用于判断是否需要 helper / 是否需要校验 maxRounds）。 */
const USES_STOP_GATE_RE = /\brunStopGate\s*\(/
const USES_MULTI_GATE_RE = /\brunMultiGate\s*\(/

/** maxRounds 硬编码数字字面量（违约 C2）：`maxRounds: 3` 等。 */
const HARDCODED_MAXROUNDS_RE = /\bmaxRounds\s*:\s*\d+/

/** maxRounds 正确读取配置（满足 C2）。 */
const CONFIG_DRIVEN_MAXROUNDS_RE = /\bmaxRounds\s*:\s*[^,\n]*ctx\.config\.maxReviewRounds(?:ByPhase)?/

/** helper 函数定义存在性（C4）。 */
const HELPER_DEFS: Array<{ key: string; re: RegExp }> = [
  { key: "str", re: /\bfunction\s+str\s*\(/ },
  { key: "parseVerdict", re: /\bfunction\s+parseVerdict\s*\(/ },
  { key: "formatIssues", re: /\bfunction\s+formatIssues\s*\(/ },
]
const RUN_STOP_GATE_DEF_RE = /\bfunction\s+runStopGate\s*\(/
const RUN_MULTI_GATE_DEF_RE = /\bfunction\s+runMultiGate\s*\(/

/**
 * 用 TypeScript 编译器把脚本按 JS 解析并返回**首个语法错误**的人类可读描述；无语法错误返回 null。
 *
 * 仅做**语法**解析（`createSourceFile`，不做类型检查、不执行），收集 `parseDiagnostics`
 * （括号/引号/逗号缺失或多余等结构性错误）。这与 extractMeta 的「只解析 meta 声明」不同——
 * 本函数解析整个脚本（含函数体），从而能拦住函数体内的语法错误。
 *
 * 返回的描述含错误信息与近似行列号，供模型定位修正。纯函数、不抛。
 */
async function firstSyntaxError(src: string): Promise<string | null> {
  const ts = await getTs()
  // setParentNodes=false 即可（只看诊断）；按 .mjs 的 JS 脚本解析。
  const sf = ts.createSourceFile("__wf_create__.mjs", src, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS)
  // parseDiagnostics 是内部字段（同 extractMeta 所用 API 家族），承载纯语法诊断。
  const diagnostics = (sf as unknown as { parseDiagnostics?: TsDiagnosticWithLocation[] }).parseDiagnostics
  if (!diagnostics || diagnostics.length === 0) return null
  const d = diagnostics[0]
  const message = ts.flattenDiagnosticMessageText(d.messageText, "\n")
  let where = ""
  if (typeof d.start === "number") {
    const { line, character } = sf.getLineAndCharacterOfPosition(d.start)
    where = `（第 ${line + 1} 行第 ${character + 1} 列附近）`
  }
  return `${message}${where}`
}

/**
 * 校验动态 workflow 脚本内容是否满足框架契约。
 *
 * @param content 脚本源码文本。
 * @returns `{ passed, violations }`；`passed === (violations.length === 0)`。
 */
export async function validateWorkflowScript(content: string): Promise<ValidationResult> {
  const src = String(content ?? "")
  const violations: ContractViolation[] = []

  // ---- C0：JS 语法完整性（最高优先，语法坏则短路）----
  // 用 TS 编译器把整个脚本按 JS 解析并收集**语法**诊断（不做类型检查）。模型偶发产出
  // 括号缺失/多余等语法错误（如 `unresolved.push "..."` 缺左括号），既有正则契约校验与
  // extractMeta（仅解析 meta 声明、不碰函数体）都漏判，会让坏脚本落盘、运行时才报
  // SCRIPT_SYNTAX_ERROR。此处在写盘前拦截。语法坏时其余正则契约无意义，直接短路返回。
  const syntaxError = await firstSyntaxError(src)
  if (syntaxError) {
    return {
      passed: false,
      violations: [
        {
          contract: "C0",
          name: "JS 语法完整性",
          detail: `脚本存在 JS 语法错误，无法被加载执行：${syntaxError}`,
          fix: "修正脚本语法错误（如缺失/多余的括号、引号、逗号）后重新调用本工具。可先用 `node --check <file>` 自查。",
        },
      ],
    }
  }

  // ---- C0b：运行时编译器预检（bun transpile 静态拒绝项，语法诊断覆盖不到）----
  // bun 在模块 transpile 阶段即静态拒绝部分**语义**错误（典型：const 重复赋值
  // "This assignment will throw because \"x\" is a constant"）——TS parser 的纯语法
  // 诊断不覆盖此类错误，坏脚本会通过 C0 落盘、运行时 import() 才炸且错误被笼统包装。
  // 此处用与运行时 import() **同一编译器**做写盘前预检（纯静态 transform，不执行代码），
  // 错误信息直接进入 violations 供模型自修循环定位修正。非 bun 环境（Bun 全局不可用）
  // 跳过该校验（transformer 缺席时行为与既有版本一致）。
  if (typeof Bun !== "undefined" && typeof Bun.Transpiler === "function") {
    try {
      new Bun.Transpiler({ loader: "js" }).transformSync(src)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return {
        passed: false,
        violations: [
          {
            contract: "C0",
            name: "JS 语法完整性",
            detail: `脚本无法被运行时编译器加载（写盘前预检）：${detail}`,
            fix: "按错误信息修正脚本后重新调用本工具。常见案例：修正结果会回写的变量须用 let 声明（如 `let artifact = ...; if (fixed != null) artifact = fixed`），const 声明的变量不可重复赋值。",
          },
        ],
      }
    }
  }

  // ---- C1：配置读取路径 ----
  if (FLAT_CONFIG_RE.test(src)) {
    violations.push({
      contract: 1,
      name: "配置读取路径",
      detail:
        "检测到扁平资源访问 config.template/rules/review；框架配置是 ctx.config.resources 字典，扁平路径读不到（永远为空）。",
      fix: 'const templatePaths = ctx.config.resources?.["template"] ?? []',
    })
  }

  // ---- C2：审查轮次配置驱动（仅当存在门控时才有意义；存在硬编码即违约）----
  const usesGate = USES_STOP_GATE_RE.test(src) || USES_MULTI_GATE_RE.test(src)
  if (usesGate && HARDCODED_MAXROUNDS_RE.test(src) && !CONFIG_DRIVEN_MAXROUNDS_RE.test(src)) {
    violations.push({
      contract: 2,
      name: "审查轮次配置驱动",
      detail:
        "检测到硬编码 maxRounds 数字字面量；门控轮次应可配置，须读 ctx.config.maxReviewRounds（或 per-phase 的 maxReviewRoundsByPhase）。",
      fix: 'maxRounds: ctx.config.maxReviewRoundsByPhase["阶段名"] ?? ctx.config.maxReviewRounds',
    })
  }

  // ---- C4：helper 完整性（仅当使用门控时要求）----
  if (usesGate) {
    const missing: string[] = []
    for (const h of HELPER_DEFS) {
      if (!h.re.test(src)) missing.push(h.key + "()")
    }
    if (USES_STOP_GATE_RE.test(src) && !RUN_STOP_GATE_DEF_RE.test(src)) missing.push("runStopGate()")
    if (USES_MULTI_GATE_RE.test(src) && !RUN_MULTI_GATE_DEF_RE.test(src)) missing.push("runMultiGate()")
    if (missing.length > 0) {
      violations.push({
        contract: 4,
        name: "helper 完整性",
        detail:
          "脚本使用了门控但缺少内联 helper 定义：" +
          missing.join(" / ") +
          "；运行时会报 `xxx is not defined`。",
        fix: "从 opencode-workflows/workflows/default-code/index.mjs 的「内联辅助」section 完整复制 str/parseVerdict/formatIssues/runStopGate/runMultiGate 函数定义。",
      })
    }
  }

  // ---- C6：禁止 import Node.js 模块 ----
  const importRe = /^\s*import\s+.+\s+from\s+['"](?:fs|path|os|crypto|child_process|stream|net|http|https|url|util)['"]/gm
  const importMatch = src.match(importRe)
  if (importMatch) {
    const modules = importMatch.map((m) => m.match(/from\s+['"]([^'"]+)['"]/)?.[1] || "?").join(" / ")
    violations.push({
      contract: "C6",
      name: "禁止 import Node.js 模块",
      detail: `检测到 import Node.js 模块：${modules}；workflow 运行在沙箱内，不支持 Node.js 原生模块。`,
      fix: "删除 import 语句，改用 ctx 提供的 API（ctx.agent / ctx.writeFile 等）。读资源文件交给子 Agent 的 read 工具，脚本不自己读文件。",
    })
  }

  // ---- C7：export default 必须是函数（不是对象字面量）----
  const exportDefaultObjRe = /export\s+default\s+\{/
  if (exportDefaultObjRe.test(src)) {
    const hasExportDefaultFunc = /export\s+default\s+(async\s+)?function/.test(src)
    if (!hasExportDefaultFunc) {
      violations.push({
        contract: "C7",
        name: "export default 必须是函数",
        detail:
          "检测到 export default { ... } 对象字面量；ScriptLoader 期望 default 导出为函数（async function execute(ctx)）。",
        fix: "export default async function execute(ctx) { ... }",
      })
    }
  }

  // ---- C8：禁止臆造 ctx API ----
  // 白名单 = OrchestrationAPI（src/api/orchestration-api.ts）真实暴露给脚本的方法/字段。
  // ⚠ 不含 readFile：运行时 ctx **没有** readFile，脚本不能自己读文件——资源文件由子 Agent
  // 用其 read 工具读取（脚本只把 ctx.config.resourcesByPhase 拿到的路径塞进 prompt 引导子 Agent）。
  const allowedCtxApis = ["agent", "parallel", "pipeline", "writeFile", "workflow", "phase", "log", "config", "args", "runId", "extension"]
  const ctxApiRe = /\bctx\.([a-zA-Z_]\w*)\s*[(\[.]/g
  const foundApis = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = ctxApiRe.exec(src)) !== null) {
    foundApis.add(match[1])
  }
  const fabricated = Array.from(foundApis).filter((api) => !allowedCtxApis.includes(api))
  if (fabricated.length > 0) {
    // readFile 是最高频误用：给出专门的「改用 read 工具」修正引导。
    const readFileHint = fabricated.includes("readFile")
      ? "ctx 没有 readFile——脚本不能自己读文件。正确做法：从 ctx.config.resourcesByPhase?.[阶段]?.[类别] 取路径数组，" +
        "把路径拼进给子 Agent 的 prompt 并写明「请先用 read 工具读取其内容」，由子 Agent 读取。"
      : ""
    violations.push({
      contract: "C8",
      name: "禁止臆造 ctx API",
      detail: `检测到未知的 ctx 方法：${fabricated.join(" / ")}；这些方法不存在，运行时会报错。${readFileHint ? "\n" + readFileHint : ""}`,
      fix: `只能使用：${allowedCtxApis.join(" / ")}。检查是否拼写错误（如 runAgent 应为 agent）。`,
    })
  }

  // ---- C10：meta.phases 必须有 title 字段 ----
  // 简化检测：找 phases: [ { ... } ] 块，检查是否有 title: 字段
  const phasesBlockRe = /phases\s*:\s*\[\s*\{[^}]+\}/
  const phasesMatch = src.match(phasesBlockRe)
  if (phasesMatch) {
    const block = phasesMatch[0]
    // 检查第一个对象是否有 title: 字段
    if (!/\btitle\s*:/.test(block)) {
      violations.push({
        contract: "C10",
        name: "meta.phases 必须有 title",
        detail: "检测到 meta.phases 数组中的对象缺少 title 字段；ScriptLoader 要求每个 phase 必须有 title。",
        fix: 'phases: [{ title: "阶段名", description: "..." }]',
      })
    }
  }

  return { passed: violations.length === 0, violations }
}
