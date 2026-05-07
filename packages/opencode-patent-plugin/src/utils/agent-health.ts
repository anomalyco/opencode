/**
 * Agent 健康检查工具
 *
 * 诊断所有 YunPat Agent 的加载、实例化和运行状态。
 */

import { loadYunPatModule } from "./yunpat-loader.js"
import { createSharedAgentContext } from "./agent-factory.js"

export interface AgentHealthReport {
  module: string
  className: string
  loadable: boolean
  instantiable: boolean
  runnable: boolean
  error?: string
  duration: number
}

const AGENT_REGISTRY = [
  { module: "agents/researcher", className: "ResearcherAgent", testInput: { question: "测试", depth: "quick", sources: ["database"], maxResults: 1 } },
  { module: "agents/search", className: "PatentSearchAgentV3", testInput: { title: "测试", field: "AI", technicalProblem: "测试", technicalSolution: "测试", keyFeatures: ["测试"] } },
  { module: "agents/search", className: "PatentSearchAgent", testInput: { title: "测试", field: "AI", technicalProblem: "测试", technicalSolution: "测试", keyFeatures: ["测试"] } },
  { module: "agents/invention", className: "InventionUnderstandingAgent", testInput: { disclosure: "测试", patentType: "发明", inventionType: "装置" } },
  { module: "agents/specification-drafter", className: "SpecificationDrafterAgent", testInput: { disclosure: "测试", patentType: "发明", inventionType: "装置" } },
  { module: "agents/claim-generator", className: "ClaimGeneratorAgent", testInput: { disclosure: "测试", patentType: "发明", inventionType: "装置" } },
  { module: "agents/abstract-drafter", className: "AbstractDrafterAgent", testInput: { disclosure: "测试", patentType: "发明", inventionType: "装置" } },
  { module: "agents/patent-responder", className: "PatentResponderAgentV5", testInput: { officeAction: "测试", originalClaims: "测试" } },
  { module: "agents/patent-responder", className: "PatentResponderAgent", testInput: { officeAction: "测试", originalClaims: "测试" } },
  { module: "agents/patent-analyzer", className: "ComparisonAnalyzerAgent", testInput: { targetPatent: "测试", referencePatents: ["测试"], analysisType: "compare" } },
  { module: "agents/quality", className: "EnhancedQualityCheckerAgent", testInput: { claims: { independentClaims: ["测试"], dependentClaims: [] }, specification: { technicalField: "测试", backgroundArt: "", summary: "", detailedDescription: "" }, documentType: "claims" } },
  { module: "agents/quality", className: "QualityCheckerAgent", testInput: { claims: { independentClaims: ["测试"], dependentClaims: [] }, specification: { technicalField: "测试", backgroundArt: "", summary: "", detailedDescription: "" }, documentType: "claims" } },
  { module: "agents/writer", className: "WriterAgent", testInput: { content: "测试", type: "specification" } },
]

/**
 * 检查单个 Agent 的健康状态
 */
export async function checkAgentHealth(
  moduleName: string,
  className: string,
  testInput: Record<string, any>,
): Promise<AgentHealthReport> {
  const start = Date.now()
  const report: AgentHealthReport = {
    module: moduleName,
    className,
    loadable: false,
    instantiable: false,
    runnable: false,
    duration: 0,
  }

  try {
    // Step 1: 加载模块
    const mod = await loadYunPatModule(moduleName)
    if (!mod?.[className]) {
      report.error = `Class ${className} not found in module ${moduleName}`
      report.duration = Date.now() - start
      return report
    }
    report.loadable = true

    // Step 2: 创建上下文
    const context = await createSharedAgentContext()
    if (!context) {
      report.error = "Failed to create agent context"
      report.duration = Date.now() - start
      return report
    }

    // Step 3: 实例化 Agent
    const AgentClass = mod[className]
    const llm = {
      chat: async () => ({
        message: { role: "assistant", content: "test" },
        content: "test",
        usage: { promptTokens: 1, completionTokens: 1 },
      }),
      embed: async () => ([]),
    }

    let agent: any
    try {
      agent = new AgentClass({
        llm,
        name: `test-${className.toLowerCase()}`,
        description: "Test agent",
        eventBus: context.eventBus,
        memory: context.memory,
        tools: context.tools,
        maxIterations: 1,
        timeout: 10000,
        enableKnowledgeGraph: false, // 禁用知识图谱加速测试
      })
      report.instantiable = true
    } catch (err: any) {
      report.error = `Instantiation failed: ${err?.message || err}`
      report.duration = Date.now() - start
      return report
    }

    // Step 4: 执行最小任务
    try {
      const result = await Promise.race([
        agent.run ? agent.run(testInput, context) : agent.execute(testInput),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout after 10s")), 10000)),
      ])
      report.runnable = true
      if (result && typeof result === "object") {
        report.error = result.success === false ? `Run returned error: ${result.error}` : undefined
      }
    } catch (err: any) {
      report.error = `Run failed: ${err?.message || err}`
    }
  } catch (err: any) {
    report.error = `Unexpected error: ${err?.message || err}`
  }

  report.duration = Date.now() - start
  return report
}

/**
 * 运行所有 Agent 的诊断
 */
export async function runAgentDiagnostics(): Promise<AgentHealthReport[]> {
  console.log("\n========================================")
  console.log("  YunPat Agent 健康检查")
  console.log("========================================\n")

  const results: AgentHealthReport[] = []

  for (const config of AGENT_REGISTRY) {
    process.stdout.write(`Testing ${config.module}/${config.className} ... `)
    const report = await checkAgentHealth(config.module, config.className, config.testInput)
    results.push(report)

    const status = report.runnable ? "✅ RUNNABLE" : report.instantiable ? "⚠️ INSTANTIABLE" : report.loadable ? "❌ NOT RUNNABLE" : "❌ NOT LOADABLE"
    console.log(status)
    if (report.error) {
      console.log(`   Error: ${report.error}`)
    }
    console.log(`   Duration: ${report.duration}ms`)
  }

  // Summary
  const loadable = results.filter(r => r.loadable).length
  const instantiable = results.filter(r => r.instantiable).length
  const runnable = results.filter(r => r.runnable).length

  console.log("\n========================================")
  console.log("  诊断汇总")
  console.log("========================================")
  console.log(`  可加载:   ${loadable}/${results.length}`)
  console.log(`  可实例化: ${instantiable}/${results.length}`)
  console.log(`  可运行:   ${runnable}/${results.length}`)
  console.log("========================================\n")

  return results
}

/**
 * 获取可运行的 Agent 列表（用于 Tool 配置）
 */
export async function getRunnableAgents(): Promise<Array<{ module: string; className: string }>> {
  const results = await runAgentDiagnostics()
  return results
    .filter(r => r.runnable)
    .map(r => ({ module: r.module, className: r.className }))
}
