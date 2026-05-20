// pipeline-builder.ts — Pipeline 构建器
// 从 pipeline_config/{mod}_pipeline_config.md 加载 Step 指令，支持用户定制化覆盖
// 加载优先级：项目 .harness/pipeline_config/ > 插件 pipeline_config/

import path from "path"
import { StepConfigLoader, type StepVars } from "./step-config-loader.js"

/** Pipeline 阶段定义 */
export interface PipelineStage {
  name: string
  description: string
  instructions: string
}

/** 结构化 Pipeline 对象 */
export interface ExecutionPipeline {
  mod: string
  stages: PipelineStage[]
  upstream_docs: string[]
  fallback_rules: Record<string, string>
}

type ValidMod = "prd" | "design" | "code" | "test"

const VALID_MODS: ValidMod[] = ["prd", "design", "code", "test"]

const UPSTREAM_DOCS: Record<ValidMod, string[]> = {
  prd:    [],
  design: ["prd"],
  code:   ["prd", "design"],
  test:   ["prd", "design", "code"],
}

const MOD_LABELS: Record<ValidMod, string> = {
  prd:    "概要设计",
  design: "详细设计",
  code:   "代码编写",
  test:   "单元测试",
}

const DOC_NAMES: Record<ValidMod, string> = {
  prd:    "概要设计文档.md",
  design: "详细设计与程序设计文档.md",
  code:   "code",
  test:   "测试报告文档.md",
}

const DEFAULT_REVIEW_ROUNDS: Record<ValidMod, number> = {
  prd: 3, design: 3, code: 2, test: 3,
}

// ── 语言无关约束提示（Code/Test 模块共用，作为 {{LANG_HINT}} 变量注入） ──
const LANG_HINT = `
⚠️ 语言无关约束：根据项目使用的编程语言选择对应工具，不要假设语言：
- 测试文件格式：Java(*Test.java/*Tests.java) / Python(test_*.py) / JS/TS(*.test.ts|*.spec.ts) / Go(*_test.go) / C#(*Tests.cs)
- 测试运行命令：Java(mvn test 或 gradle test) / Python(pytest) / JS(jest 或 vitest 或 mocha) / Go(go test ./...) / C#(dotnet test)
- 覆盖率命令：Java(mvn jacoco:report → 读取 jacoco.xml) / Python(pytest --cov) / JS(jest --coverage 或 vitest --coverage) / Go(go test -cover ./...) / C#(dotnet test --collect:"XPlat Code Coverage")
- 精度类型：Java(BigDecimal + RoundingMode.HALF_UP) / Python(Decimal + ROUND_HALF_UP) / JS(decimal.js 或 big.js) / Go(shopspring/decimal) / C#(decimal)
- Linter：Java(Checkstyle 或 SpotBugs 或 PMD) / Python(ruff 或 flake8) / JS(eslint) / Go(golangci-lint) / C#(dotnet-format)
- Java 测试框架细分（读取 pom.xml/build.gradle 的 dependencies 判断）：
  * junit:junit → JUnit 4（注解：@Test, @Before, @After；断言：Assert.assertEquals）
  * org.junit.jupiter:junit-jupiter → JUnit 5（注解：@Test, @BeforeEach, @AfterEach；断言：Assertions.assertEquals；需 maven-surefire-plugin ≥ 2.22.0）
  * org.jmockit:jmockit → JMockit（注解：@Mocked, @Injectable, @Tested；需 surefire argLine 配置 javaagent）
  * org.testng:testng → TestNG（注解：@Test, @BeforeMethod, @AfterMethod）
  * org.mockito:mockito-core → Mockito（与 JUnit 4/5 配合使用）
先通过读取 pom.xml / package.json / go.mod / *.csproj / pyproject.toml 等文件判断项目语言，再选择对应工具。

⚠️ Java/Maven 项目 pom.xml 依赖声明要求（生成或修改 pom.xml 时必须遵守）：
- JUnit 4 测试代码 → pom.xml 必须包含 junit:junit
- JUnit 5 测试代码 → pom.xml 必须包含 org.junit.jupiter:junit-jupiter
- JMockit 测试代码 → pom.xml 必须包含 org.jmockit:jmockit，且在 junit 之前
- Mockito 测试代码 → pom.xml 必须包含 org.mockito:mockito-core
- Spring Boot 项目 → pom.xml 必须包含 spring-boot-starter-test
- 版本号优先级：用户需求/规约指定 > parent pom 继承 > 默认版本`

/**
 * 构建 StepVars 变量表
 */
function buildVars(mod: ValidMod, maxReviewRounds: number): StepVars {
  const upstream = UPSTREAM_DOCS[mod]
  const upstreamStr = upstream.length > 0 ? upstream.join(" + ") : "无"
  const docName = DOC_NAMES[mod]

  return {
    MOD: mod,
    MOD_LABEL: MOD_LABELS[mod],
    CTX_FILE: `.harness/<FEATURE>/${mod}_retrieval_context.md`,
    PLAN_FILE: `.harness/<FEATURE>/${mod}_task_plan.md`,
    INDEX_FILE: ".harness/<FEATURE>/index.md",
    DOC_FILE: `docs/<FEATURE>/${docName}`,
    DOC_NAME: docName,
    UPSTREAM: upstreamStr,
    MAX_REVIEW_ROUNDS: String(maxReviewRounds),
    REVIEW_REPORT: `.harness/<FEATURE>/${mod}_review_report.md`,
    LANG_HINT,
  }
}

/**
 * 构建指定模块的 Pipeline（异步，从 pipeline_config 文件加载）
 */
export async function buildPipeline(
  mod: ValidMod | string,
  extra?: {
    max_review_rounds?: number
    pluginDir?: string
    projectDir?: string
  }
): Promise<ExecutionPipeline> {
  if (!VALID_MODS.includes(mod as ValidMod)) {
    throw new Error(`无效的模块类型: ${mod}，有效值为: ${VALID_MODS.join(", ")}`)
  }

  const validMod = mod as ValidMod
  const maxReviewRounds = extra?.max_review_rounds ?? DEFAULT_REVIEW_ROUNDS[validMod]
  const pluginDir = extra?.pluginDir ?? path.join(import.meta.dir, "..", "..")
  const projectDir = extra?.projectDir ?? process.cwd()

  const loader = new StepConfigLoader(pluginDir, projectDir)
  const vars = buildVars(validMod, maxReviewRounds)
  const steps = await loader.loadModuleConfig(validMod, vars)

  return {
    mod: validMod,
    stages: steps.map(s => ({
      name: s.name,
      description: s.description,
      instructions: s.instructions,
    })),
    upstream_docs: UPSTREAM_DOCS[validMod],
    fallback_rules: {
      template_not_found: "使用空白文档结构",
      rules_unavailable: "跳过规约检索",
      review_timeout: `超过 ${maxReviewRounds} 轮审查后输出当前最佳版本 + 未解决问题清单`,
    },
  }
}

/**
 * 将 Pipeline 对象组装为可注入的文本
 */
export function assemblePipeline(pipeline: ExecutionPipeline): string {
  const mod = pipeline.mod.toUpperCase()
  const label = MOD_LABELS[pipeline.mod as ValidMod] ?? pipeline.mod

  const lines: string[] = [
    `# ${mod} EXECUTION_PIPELINE`,
    `# 模块: ${label}（${pipeline.mod}）`,
    `# 阶段数: ${pipeline.stages.length}`,
  ]

  if (pipeline.upstream_docs.length > 0) {
    lines.push(`# 上游文档: ${pipeline.upstream_docs.join(", ")}`)
  }

  lines.push("")

  for (const stage of pipeline.stages) {
    lines.push(`## ${stage.name}: ${stage.description}`)
    lines.push("")
    lines.push(stage.instructions)
    lines.push("")
  }

  return lines.join("\n")
}
