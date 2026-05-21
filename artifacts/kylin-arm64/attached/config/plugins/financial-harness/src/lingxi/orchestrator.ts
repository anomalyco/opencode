// orchestrator.ts — 四阶段编排器（渐进注入模式）
// 不再一次性生成 mega-pipeline，而是按需生成单阶段 pipeline

import path from "path"
import { ConfigLoader, type LingxiHarnessConfig, type ResolvedPhaseConfig, type ResolvedValue, type PhaseId } from "./config-loader.js"
import type { RequirementSource } from "./feature-identity.js"
import { buildPipeline, type PipelineStage } from "../pipeline/pipeline-builder.js"

const PHASE_LABELS: Record<PhaseId, string> = {
  prd: "概要设计阶段",
  design: "详细设计阶段",
  code: "代码编写阶段",
  test: "单元测试阶段",
}

const ALL_PHASES: PhaseId[] = ["prd", "design", "code", "test"]

export class LingxiOrchestrator {
  private configLoader = new ConfigLoader()

  constructor(
    private config: LingxiHarnessConfig,
    private featureId: string,
    private directory: string,
    private featureMeta?: { title?: string; request?: string; requirementSource?: RequirementSource },
  ) {}

  /**
   * 生成第一阶段的 Pipeline（含全局 header）
   * 用于 /lingxi_harness 首次注入
   */
  async buildFirstPhase(): Promise<string> {
    const firstPhase = ALL_PHASES[0]
    const sections: string[] = [
      this.buildCommandAnalysis(),
      await this.buildStepPrompt(firstPhase, "Step_0"),
    ]
    return sections.join("\n")
  }

  /**
   * 生成阶段切换时注入的 Pipeline
   * 用于 update-progress 完成后自动注入下一阶段
   */
  async buildPhaseTransition(completedPhase: PhaseId, nextPhase: PhaseId): Promise<string> {
    const nextIndex = ALL_PHASES.indexOf(nextPhase)

    const sections: string[] = [
      `\n${"═".repeat(60)}`,
      `# 阶段切换：${PHASE_LABELS[completedPhase]} ✅ → ${PHASE_LABELS[nextPhase]}（${nextIndex + 1}/4）`,
      `${"═".repeat(60)}`,
      ``,
      `上一阶段（${PHASE_LABELS[completedPhase]}）已完成。自动进入${PHASE_LABELS[nextPhase]}。`,
      ``,
      await this.buildStepPrompt(nextPhase, "Step_0"),
    ]

    return sections.join("\n")
  }

  async buildStepPrompt(phase: PhaseId, stepName: string): Promise<string> {
    const phaseIndex = ALL_PHASES.indexOf(phase)
    const stages = await this.getConfiguredPipeline(phase)
    const stepIndex = stages.findIndex((item) => item.name === stepName)
    const stage = stages[stepIndex]
    if (!stage) {
      throw new Error(`未知 Step: ${phase}/${stepName}`)
    }
    const sections: string[] = [
      this.buildPhaseHeader(phase, phaseIndex, stepName, stepIndex, stages.length),
      this.stageToText(phase, phaseIndex, stage, stepIndex === stages.length - 1),
    ]
    return sections.join("\n")
  }

  async getStepNames(phase: PhaseId): Promise<string[]> {
    const pipeline = await this.getConfiguredPipeline(phase)
    return pipeline.map((stage) => stage.name)
  }

  private buildCommandAnalysis(): string {
    return `# LINGXI_ORCHESTRATION_CONTEXT
User Request: ${this.featureMeta?.request ?? ""}
Requirement Source: ${this.featureMeta?.requirementSource?.path ?? this.featureMeta?.requirementSource?.type ?? "inline"}
Feature ID: ${this.featureId}
Feature Title: ${this.featureMeta?.title ?? this.featureId}
Workflow: PRD -> Design -> Code -> Test
Execution Mode: step-by-step

# 全局执行契约
- 当前只执行注入的 CURRENT_STEP_INSTRUCTION。
- 每个 Step 完成后先调用 update-step。
- 只有阶段最后一个 Step 完成并收到系统提示后，才调用 update-progress 触发下一阶段。
- 非最后 Step 严禁调用 update-progress。`
  }

  private buildPhaseHeader(phase: PhaseId, phaseIndex: number, stepName: string, stepIndex: number, stepCount: number): string {
    return `\n${"═".repeat(60)}
# ${phaseIndex + 1}/4: ${PHASE_LABELS[phase]}（${phase.toUpperCase()}）
${"═".repeat(60)}
${this.buildPhaseGuard(phase, stepName, stepIndex, stepCount)}

# ${phase.toUpperCase()} EXECUTION_PIPELINE
# 模块: ${PHASE_LABELS[phase]}（${phase}）
# 当前仅展示本阶段的一个 Step，本阶段共有 ${stepCount} 个 Step`
  }

  private buildPhaseGuard(phase: PhaseId, stepName: string, stepIndex: number, stepCount: number): string {
    const resolved = this.configLoader.resolve(phase, this.config)
    const outputPathHint = resolved.output_path
      ? `\n# 输出路径: ${resolved.output_path.replace(/<FEATURE>/g, this.featureId)}`
      : ""
    const isFinalStep = stepIndex === stepCount - 1
    const stepNumber = stepIndex + 1
    const completionRule = isFinalStep
      ? `# Completion Rule: 本 Step 完成后先调用 update-step(feature="${this.featureId}", module="${phase}", step="${stepName}", status="done")；收到系统提示后再调用 update-progress。`
      : `# Completion Rule: 本 Step 完成后只调用 update-step(feature="${this.featureId}", module="${phase}", step="${stepName}", status="done")。`
    const forbiddenRule = isFinalStep
      ? "# Forbidden: 未完成当前 Step 前禁止调用 update-progress。"
      : `# Forbidden: ${stepName} 完成后禁止调用 update-progress；当前 Step 不是阶段最后一步。`

    return `# LINGXI_HARNESS — 阶段注入
# Feature ID: ${this.featureId}
${this.featureMeta?.title ? `# Feature Title: ${this.featureMeta.title}\n` : ""}${this.featureMeta?.requirementSource?.path ? `# Requirement Source: ${this.featureMeta.requirementSource.path}\n` : ""}# Current Phase: ${phase}
# CURRENT_STEP_INSTRUCTION
# Current Step: ${stepName}
# Step Index: ${stepNumber}/${stepCount}
# Is Final Step: ${isFinalStep}
# Allowed Scope: 只执行 ${phase} 的 ${stepName}，禁止执行其它阶段或后续 Step
# MUST follow injected pipeline_config
# Output Dir: docs/${this.featureId}/
# 配置: lingxi_harness_config.json
#
# ⚠️ 全局约束：
# G1. 测试必须真实运行，不允许编造
# G2. 不允许跳过当前注入的 Step
# G3. 当前 Step 完成后调用 update-step；只有阶段最后一个 Step 完成并收到系统提示后才调用 update-progress
# G4. 如果项目已有代码，只处理新增部分
${completionRule}
${forbiddenRule}
${!isFinalStep ? `${stepName} 完成后禁止调用 update-progress。` : ""}${outputPathHint}`
  }

  private buildFooter(): string {
    return `\n${"═".repeat(60)}
# 全链路完成
${"═".repeat(60)}
四个阶段全部完成后：
1. 调用 query-progress 确认所有模块状态为 done
2. 向用户汇报完整执行结果
3. 提示用户检查产出文档`
  }

  private async getConfiguredPipeline(phase: PhaseId): Promise<PipelineStage[]> {
    const pipeline = await buildPipeline(phase, {
      pluginDir: path.join(import.meta.dir, "..", ".."),
      projectDir: this.directory,
    })
    return pipeline.stages
  }

  private stageToText(phase: PhaseId, phaseIndex: number, stage: PipelineStage, isFinalStep: boolean): string {
    if (stage.name === "Step_1") {
      return this.buildStage0Replacement(this.configLoader.resolve(phase, this.config), phase)
    }

    const nextPhase = ALL_PHASES[phaseIndex + 1] ?? null
    const instructions = this.applyFeatureVars(this.injectAutoFlow(stage.instructions, phase, nextPhase))
    const stepCompletionFooter = isFinalStep
      ? `\n\n⚠️ Lingxi 渐进注入收尾规则：本 Step 完成后先调用 update-step(feature="${this.featureId}", module="${phase}", step="${stage.name}", status="done")。收到"阶段所有 Step 已完成"的系统提示后，再调用 update-progress。`
      : `\n\n⚠️ Lingxi Step 收尾规则：${stage.name} 完成后停止当前 Step，调用 update-step(feature="${this.featureId}", module="${phase}", step="${stage.name}", status="done")。不要自行进入下一 Step，也不要调用 update-progress。`
    return `## ${stage.name}: ${stage.description}

${instructions}${stepCompletionFooter}`
  }

  private buildStage0Replacement(resolved: ResolvedPhaseConfig, phase: PhaseId): string {
    const tDesc = this.describeValues(resolved.template, "模板")
    const sDesc = this.describeValues(resolved.rules, "规约")
    const rDesc = this.describeValues(resolved.review, "审查文档")

    const outputPathHint = resolved.output_path
      ? `\n**输出路径**（已从配置读取）：${resolved.output_path.replace(/<FEATURE>/g, this.featureId)}`
      : ""

    return this.applyFeatureVars(`## Step_1: 配置注入（自动 — lingxi_harness 模式）

⚠️ 本阶段由 lingxi_harness_config.json 配置驱动，不调用 question 工具。

**模板选择**（已从配置读取）：${tDesc}
**规约选择**（已从配置读取）：${sDesc}
**审查文档**（已从配置读取）：${rDesc}
**最大审查轮次**（已从配置读取）：${resolved.max_review_rounds} 轮${outputPathHint}

本 Step 完成后调用 update-step(feature="${this.featureId}", module="${phase}", step="Step_1", status="done")。
收到下一条注入前，不要自行进入 Step_2，也不要调用 update-progress。`)
  }

  private applyFeatureVars(text: string): string {
    return text
      .replaceAll("<FEATURE_TITLE>", this.featureMeta?.title ?? this.featureId)
      .replaceAll("{{FEATURE_TITLE}}", this.featureMeta?.title ?? this.featureId)
  }

  private describeValues(values: ResolvedValue[], label: string): string {
    const active = values.filter(v => v.type !== "skip" && v.type !== "none")
    if (active.length === 0) return values[0]?.type === "none" ? `不使用${label}` : `跳过${label}`
    if (active.length === 1) return this.describeValue(active[0], label)
    return active.map((v, i) => `\n  ${i + 1}. ${this.describeValue(v, label)}`).join("")
  }

  private describeValue(v: ResolvedValue, label: string): string {
    switch (v.type) {
      case "builtin": return `使用内置${label}（${v.value}）`
      case "local":   return `使用本地文件（${v.value}）`
      case "none":    return `不使用${label}`
      case "skip":    return `跳过${label}`
      default:        return `未知配置`
    }
  }

  private injectAutoFlow(pipeline: string, current: PhaseId, next: PhaseId | null): string {
    if (next) {
      // 替换"不要自动进入下一阶段"为"调用 update-progress 后下一阶段会自动注入"
      return pipeline
        .replace(
          /⚠️.*模块 Pipeline 到此结束。不要自动进入下一阶段。[\s\S]*?等待用户明确指令后再继续。/g,
          `${PHASE_LABELS[current]}完成。调用 update-progress 后，下一阶段（${PHASE_LABELS[next]}）会自动注入。`
        )
        .replace(
          /下一步请执行.*命令.*阶段。/g,
          `调用 update-progress 后自动继续。`
        )
    }
    return pipeline.replace(
      /⚠️.*模块 Pipeline 到此结束[\s\S]*?等待用户明确指令后再继续。/g,
      "单元测试阶段完成。全链路已全部执行完毕。"
    )
  }
}
