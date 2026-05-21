// state.ts — SessionState 管理，含子 session 状态继承机制

export interface StageProgress {
  specRetrieved: boolean       // MCP get_spec() 或 websearch 是否调用
  templateRead: boolean        // 模板/规约文件是否读取
  codebaseAnalyzed: boolean    // grep/glob 是否调用
  documentWritten: boolean     // 文档是否写入
  testsWritten: boolean        // 测试文件是否写入（Code 模块）
  testsPassed: boolean         // 测试是否通过（Code 模块）
  reviewDone: boolean          // 审查是否完成
  reviewRounds: number         // 审查轮次计数（上限 3）
}

/** 项目语言和构建工具检测结果 */
export type ProjectLang = "python" | "java" | "js" | "ts" | "go" | "csharp" | "rust" | "unknown"
export type BuildTool = "maven" | "gradle" | "npm" | "yarn" | "bun" | "go" | "dotnet" | "cargo" | "uv" | "pip"
export type JavaTestFramework = "junit4" | "junit5" | "jmockit" | "testng" | "unknown"

export interface ProjectLanguage {
  lang: ProjectLang
  buildTool?: BuildTool
  testFramework?: string  // java: "junit4"|"junit5"|"jmockit" / python: "pytest" / js: "jest"|"vitest" ...
  javaTestFramework?: JavaTestFramework  // Java 专用：细分测试框架
}

/** 待注入的 Step 信息（延迟到 session idle 后注入） */
export interface PendingInjection {
  type: "step" | "phase-transition" | "phase-complete"
  sessionId: string
  text: string
}

export interface SessionState {
  currentModule: string        // 当前模块类型：prd/design/code/test/lingxi_harness
  noTemplate: boolean          // 用户选择"不使用模板"
  useLocalTemplate: boolean    // 用户使用本地模板（跳过 Hook 层固定章节验证，Agent 审查层做严格审查）
  skipSpec: boolean            // 用户选择"跳过规约"（豁免 specRetrieved 检查）
  pendingLocalRead: boolean    // Step_0 用户输入了本地模板路径，等待 read 工具触发 templateRead
  pendingLocalSpec: boolean    // Step_0 用户输入了本地规约路径，等待 read 工具触发 specRetrieved
  isLingxiHarness: boolean        // lingxi_harness 全链路自动化模式标记
  lingxiCurrentPhase?: "prd" | "design" | "code" | "test"  // 当前 lingxi_harness 执行的阶段
  lingxiPhaseQueue?: Array<"prd" | "design" | "code" | "test">  // lingxi_harness 剩余阶段队列
  lingxiCurrentStep?: string   // 当前 lingxi_harness 执行的 Step
  lingxiStepQueue?: string[]   // 当前阶段剩余 Step 队列
  lingxiFeatureId?: string     // lingxi_harness 的 featureId（跨阶段共享）
  lingxiFeatureTitle?: string  // lingxi_harness 的业务标题（跨阶段展示）
  lingxiRequirementSource?: any // lingxi_harness 的需求来源（跨阶段恢复）
  lingxiConfig?: any           // lingxi_harness 的配置（跨阶段共享）
  lingxiClient?: any           // session.prompt API 引用（用于阶段切换注入）
  pendingInjection?: PendingInjection  // 延迟注入：等待 session idle 后通过 promptAsync 注入
  filesModified: string[]      // 本 session 修改的文件列表
  projectLanguage?: ProjectLanguage  // 检测到的项目语言（由 Step_2 环境检测写入）
  stageProgress: StageProgress
}

// 全局状态存储
export const sessions = new Map<string, SessionState>()
export const parentMap = new Map<string, string>()  // childSessionID → parentSessionID

export function createEmptyStageProgress(): StageProgress {
  return {
    specRetrieved: false,
    templateRead: false,
    codebaseAnalyzed: false,
    documentWritten: false,
    testsWritten: false,
    testsPassed: false,
    reviewDone: false,
    reviewRounds: 0,
  }
}

export function createEmptyState(): SessionState {
  return {
    currentModule: "",
    noTemplate: false,
    useLocalTemplate: false,
    skipSpec: false,
    pendingLocalRead: false,
    pendingLocalSpec: false,
    isLingxiHarness: false,
    lingxiCurrentPhase: undefined,
    filesModified: [],
    projectLanguage: undefined,
    stageProgress: createEmptyStageProgress(),
  }
}

/**
 * 获取 session 状态，支持从父 session 继承
 * 子 session（OmO task 工具创建）继承父 session 的 stageProgress
 */
export function getState(sessionId: string): SessionState {
  let state = sessions.get(sessionId)
  if (!state) {
    const parentId = parentMap.get(sessionId)
    const parentState = parentId ? sessions.get(parentId) : undefined
    if (parentState) {
      // 子 session 继承父 session 状态，但独立追踪文件修改
      state = {
        ...structuredClone(parentState),
        filesModified: [],
      }
    } else {
      state = createEmptyState()
    }
    sessions.set(sessionId, state)
  }
  return state
}

// ── 辅助函数 ──────────────────────────────────────────────

/** 判断是否为测试文件（多语言支持） */
export function isTestFile(filePath: string): boolean {
  const name = filePath.split(/[\\/]/).pop() ?? ""
  return (
    // Python
    name.startsWith("test_") || name.endsWith("_test.py") ||
    // Java (JUnit / JMockit / TestNG / Spock)
    name.endsWith("Test.java") || name.endsWith("Tests.java") ||
    name.endsWith("Spec.java") || name.endsWith("IT.java") ||
    // TypeScript / JavaScript
    name.endsWith(".test.ts") || name.endsWith(".spec.ts") ||
    name.endsWith(".test.tsx") || name.endsWith(".spec.tsx") ||
    name.endsWith(".test.js") || name.endsWith(".spec.js") ||
    // Go
    name.endsWith("_test.go") ||
    // C#
    name.endsWith("Tests.cs") || name.endsWith("Test.cs") || name.endsWith("Spec.cs") ||
    // Rust
    false  // Rust 测试内嵌在源文件中，不单独判断文件名
  )
}

/** 多语言代码文件扩展名 */
const CODE_EXTENSIONS = [".py", ".java", ".ts", ".tsx", ".js", ".jsx", ".go", ".cs", ".rs", ".kt", ".scala"]

/** 判断是否为代码文件（多语言） */
export function isCodeFile(filePath: string): boolean {
  return CODE_EXTENSIONS.some(ext => filePath.endsWith(ext))
}

// 需要触发文档验证的目标文件名前缀（不含路径）
const DOC_PREFIXES = ["prd", "design", "code", "test"]

/** 判断是否为文档文件（文件名以 prd/design/code/test 开头的 .md，排除 .harness/ 内部状态文件） */
export function isDocFile(filePath: string): boolean {
  if (!filePath.endsWith(".md")) return false
  // 排除 .harness/ 目录下的内部状态文件
  const lower = filePath.toLowerCase().replace(/\\/g, "/")
  if (lower.includes(".harness/")) return false
  const basename = filePath.split(/[\\/]/).pop()?.toLowerCase() ?? ""
  return DOC_PREFIXES.some((p) => basename.startsWith(p))
}

/** 判断是否为文档或代码文件（需要检索验证，排除 .harness/ 内部文件） */
export function isDocOrCode(filePath: string): boolean {
  const lower = filePath.toLowerCase().replace(/\\/g, "/")
  if (lower.includes(".harness/")) return false
  return isCodeFile(filePath) || isDocFile(filePath)
}

/** 检测文档类型（基于文件名前缀匹配，排除 .harness/ 内部文件） */
export function detectDocType(filePath: string): "prd" | "design" | "test" | "unknown" {
  const lower = filePath.toLowerCase().replace(/\\/g, "/")
  if (lower.includes(".harness/")) return "unknown"
  const basename = filePath.split(/[\\/]/).pop()?.toLowerCase() ?? ""
  if (basename.startsWith("prd")) return "prd"
  if (basename.startsWith("design")) return "design"
  if (basename.startsWith("test")) return "test"
  return "unknown"
}

/** 判断是否为模板或规约文件（触发 templateRead 标记） */
export function isTemplateOrSpec(filePath: string): boolean {
  if (!filePath) return false
  const lower = filePath.toLowerCase().replace(/\\/g, "/")
  // 排除 .harness/ 内部状态文件（prd_retrieval_context.md 等不是模板）
  if (lower.includes(".harness/")) return false
  return (
    lower.includes("template") ||
    lower.includes("spec") ||
    lower.includes("规约") ||
    lower.includes("harness-rules") ||
    (lower.endsWith(".md") && (lower.includes("prd") || lower.includes("design") || lower.includes("code") || lower.includes("test")))
  )
}
