/**
 * OpenCode Workflows —— quality-helpers（质量模式 helper 单一来源）。
 *
 * 本文件是三个质量模式 helper 的唯一金标准源，以三种形态对外：
 *   1. 源行常量（ADVERSARIAL_HELPER_SRC / FINDER_LOOP_HELPER_SRC / JUDGE_PANEL_HELPER_SRC）
 *      —— helper 函数体的 JavaScript 代码行数组，供 scaffold.ts 注入 .mjs 脚本。
 *   2. 注入函数（runAdversarialHelperLines / runFinderLoopHelperLines / runJudgePanelHelperLines）
 *      —— 返回上述源行，供 renderScript 按需注入（与 gateHelperLines 同款风格）。
 *   3. 可导出纯函数（runAdversarial / runFinderLoop / runJudgePanel）
 *      —— TypeScript 实现的同名函数，供单测以 mock ctx 直接断言行为。
 *
 * 另外提供 verdictOnlyHelperLines()：仅含 parseVerdict（不包含 formatIssues 与 runStopGate），
 * 在「有 adversarial 但无 gate」时单独注入，与 gateHelperLines() 内联体共享同一份 parseVerdict 源行。
 *
 * 三者同源，保证 scaffold 渲染版、描述层模板版、测试版行为永不漂移。
 *
 * @see ../../.kiro/specs/scaffold-quality-patterns/design.md — 组件 3
 * Requirements: 3.3, 3.4, 3.5, 3.6, 5.3, 5.4, 5.5, 5.6, 5.7, 7.3, 7.4, 7.5, 7.6, 7.7, 9.4, 9.5
 */

import { parseVerdict } from "./scaffold"

// ============================================================================
// 类型定义
// ============================================================================

export interface AdversarialOpts {
  phaseTitle: string
  artifact: unknown
  fanout: number
  threshold: number
  prompt: (artifact: unknown) => string
  agentType?: string
}

export interface FinderLoopOpts {
  phaseTitle: string
  convergenceRounds: number
  maxRounds: number
  prompt: (seenList: string, round: number) => string
  parseItems?: (raw: unknown) => string[]
  agentType?: string
}

export interface JudgePanelOpts {
  phaseTitle: string
  perspectives: string[]
  draftPrompt: (perspective: string) => string
  scorePrompt: (draft: unknown) => string
  synthesisPrompt: (scoredText: string) => string
  agentType?: string
}

export interface AdversarialResult {
  passed: boolean
  refutedCount: number
  threshold: number
  reasons: string[]
  artifact: unknown
}

// ============================================================================
// parseVerdict 行 — 与 gateHelperLines() 内联体共享
// ============================================================================

/** verdictOnlyHelperLines 中 parseVerdict 函数体各行（同 gateHelperLines 内联体）。 */
const PARSE_VERDICT_SRC: string[] = [
  'function parseVerdict(text) {',
  '  const s = String(text ?? "")',
  '  if (s.trim().length === 0) return { passed: false, evaluable: false, issues: ["判定不可解析"] }',
  '  const lines = s.split(/\\r?\\n/)',
  '  const re = /(?:判定|verdict)\\s*[:：]\\s*(不通过|通过|fail|pass)/i',
  '  let verdictIdx = -1',
  '  for (let i = lines.length - 1; i >= 0; i--) {',
  '    if (re.test(lines[i])) { verdictIdx = i; break }',
  '  }',
  '  if (verdictIdx < 0) return { passed: false, evaluable: false, issues: ["判定不可解析"] }',
  '  const m = re.exec(lines[verdictIdx])',
  '  const token = (m && m[1] ? m[1] : "").toLowerCase()',
  '  const passed = !(token.indexOf("不通过") >= 0 || token === "fail") && (token.indexOf("通过") >= 0 || token === "pass")',
  '  const prose = lines.filter((_, i) => i !== verdictIdx).join("\\n").trim()',
  '  return { passed, evaluable: true, issues: passed ? [] : (prose ? [prose] : []) }',
  '}',
]

/**
 * 返回仅含 parseVerdict 函数的源行（不含 formatIssues 和 runStopGate）。
 * 当脚本含 adversarial 步但无 gate 步时单独注入，避免缺失 parseVerdict。
 * 与 gateHelperLines() 内联体的 parseVerdict 共享同一份源文本。
 *
 * Requirements: 3.2
 */
export function verdictOnlyHelperLines(): string[] {
  return [
    "/** 从自由文本解析末行判定（中英双语，取末个匹配，「不通过/fail」优先）。 */",
    ...PARSE_VERDICT_SRC,
  ]
}

// ============================================================================
// ADVERSARIAL_HELPER_SRC — runAdversarial 源行
// ============================================================================

/**
 * runAdversarial helper 的完整 JavaScript 源代码行（唯一真相来源）。
 *
 * 语义：并发派 fanout 个反驳者，每个反驳者 prompt 含待验证产物；
 * 对每个反驳结果：null/不可解析 保守判已反驳；判不通过 = 已反驳；
 * refutedCount >= threshold 时产物被杀掉，否则通过。
 * 返回前 ctx.log() 出反驳统计（No silent caps）。
 *
 * Requirements: 3.3, 3.4, 3.5, 3.6
 */
export const ADVERSARIAL_HELPER_SRC: string[] = [
  '/** 对抗式验证：N 反驳者并发挑战产物，达阈值即判不通过（不确定默认判已反驳）。 */',
  'async function runAdversarial(ctx, { phaseTitle, artifact, fanout, threshold, prompt, agentType }) {',
  '  const refuters = await ctx.parallel(',
  '    Array.from({ length: fanout }, (_, i) => () => {',
  '      const opts = { label: phaseTitle + " · 反驳者 " + (i + 1) + "/" + fanout, phase: phaseTitle }',
  '      if (agentType) opts.agentType = agentType',
  '      return ctx.agent(prompt(artifact), opts)',
  '    }),',
  '  )',
  '  let refutedCount = 0',
  '  const reasons = []',
  '  for (const r of refuters) {',
  '    if (r == null) { refutedCount += 1; continue }',
  '    const v = parseVerdict(r)',
  '    if (!v.evaluable) { refutedCount += 1; continue }',
  '    if (!v.passed) { refutedCount += 1; reasons.push(...v.issues) }',
  '  }',
  '  const passed = refutedCount < threshold',
  '  ctx.log("[adversarial] 反驳 " + refutedCount + "/" + fanout + "，阈值 " + threshold + " → " + (passed ? "通过" : "已杀掉"))',
  '  return { passed, refutedCount, threshold, reasons, artifact }',
  '}',
]

/**
 * 返回 runAdversarial helper 的源行（供 scaffold.ts 注入 .mjs）。
 */
export function runAdversarialHelperLines(): string[] {
  return [...ADVERSARIAL_HELPER_SRC]
}

// ============================================================================
// FINDER_LOOP_HELPER_SRC — runFinderLoop 源行
// ============================================================================

/**
 * runFinderLoop helper 的完整 JavaScript 源代码行（唯一真相来源）。
 *
 * 语义：循环派 finder agent 直到连续 convergenceRounds 轮无新增或达 maxRounds；
 * 按 seen 去重；null 视作无新增；截断和结束时强制 ctx.log()。
 *
 * Requirements: 5.3, 5.4, 5.5, 5.6, 5.7
 */
export const FINDER_LOOP_HELPER_SRC: string[] = [
  '/** 挖到挖干：持续派 finder 直到连续 convergenceRounds 轮无新增或达 maxRounds；按 seen 去重。 */',
  'async function runFinderLoop(ctx, { phaseTitle, convergenceRounds, maxRounds, prompt, parseItems, agentType }) {',
  '  const splitItems = parseItems || ((raw) => String(raw == null ? "" : raw)',
  '    .split(/\\r?\\n/).map((s) => s.trim())',
  '    .filter((s) => s.length > 0 && s !== "[无新增]"))',
  '  const seen = new Set()',
  '  const all = []',
  '  let emptyRounds = 0',
  '  let round = 0',
  '  let truncated = false',
  '  while (emptyRounds < convergenceRounds) {',
  '    if (round >= maxRounds) { truncated = true; break }',
  '    round += 1',
  '    const opts = { label: phaseTitle + " · finder 第" + round + "轮", phase: phaseTitle }',
  '    if (agentType) opts.agentType = agentType',
  '    const raw = await ctx.agent(prompt([...seen].join("\\n"), round), opts)',
  '    const fresh = (raw == null ? [] : splitItems(raw)).filter((it) => !seen.has(it))',
  '    if (fresh.length === 0) { emptyRounds += 1; continue }',
  '    emptyRounds = 0',
  '    for (const it of fresh) { seen.add(it); all.push(it) }',
  '  }',
  '  if (truncated) ctx.log("[finder-loop] ⚠ 达上限 " + maxRounds + " 轮截断，可能仍有未挖完发现")',
  '  ctx.log("[finder-loop] 发现 " + all.length + " 条，停止原因：" + (truncated ? "截断" : "收敛(" + convergenceRounds + "轮无新增)"))',
  '  return all',
  '}',
]

/**
 * 返回 runFinderLoop helper 的源行（供 scaffold.ts 注入 .mjs）。
 */
export function runFinderLoopHelperLines(): string[] {
  return [...FINDER_LOOP_HELPER_SRC]
}

// ============================================================================
// JUDGE_PANEL_HELPER_SRC — runJudgePanel 源行
// ============================================================================

/**
 * runJudgePanel helper 的完整 JavaScript 源代码行（唯一真相来源）。
 *
 * 语义：多角度并行起草 → 过滤 null → 并发打分 → ctx.log 概览 → 综合 agent；
 * 全 null 降级返回 ""；综合 agent null 时返回 scoredText 兜底。
 *
 * Requirements: 7.3, 7.4, 7.5, 7.6, 7.7
 */
export const JUDGE_PANEL_HELPER_SRC: string[] = [
  '/** 评审团：多角度并行起草 → 并行打分 → 综合最优（含亚军亮点）。 */',
  'async function runJudgePanel(ctx, { phaseTitle, perspectives, draftPrompt, scorePrompt, synthesisPrompt, agentType }) {',
  '  const mkOpts = (label) => { const o = { label, phase: phaseTitle }; if (agentType) o.agentType = agentType; return o }',
  '  const drafts = await ctx.parallel(',
  '    perspectives.map((p, i) => () => ctx.agent(draftPrompt(p), mkOpts(phaseTitle + " · 起草[" + p + "]"))),',
  '  )',
  '  const idx = drafts.map((d, i) => ({ d, p: perspectives[i] })).filter((x) => x.d != null)',
  '  if (idx.length === 0) { ctx.log("[judge-panel] ⚠ 全部草稿降级，返回空结论"); return "" }',
  '  const scores = await ctx.parallel(',
  '    idx.map((x, i) => () => ctx.agent(scorePrompt(x.d), mkOpts(phaseTitle + " · 评分 " + (i + 1)))),',
  '  )',
  '  const scoredText = idx.map((x, i) =>',
  '    "=== [" + x.p + "] ===\\n" + (typeof x.d === "string" ? x.d : JSON.stringify(x.d, null, 2)) + "\\n--- 评分 ---\\n" + (scores[i] == null ? "（评分缺失）" : String(scores[i]))',
  '  ).join("\\n\\n")',
  '  ctx.log("[judge-panel] " + idx.length + " 个候选方案完成评分")',
  '  const best = await ctx.agent(synthesisPrompt(scoredText), mkOpts(phaseTitle + " · 综合最优"))',
  '  return best == null ? scoredText : best',
  '}',
]

/**
 * 返回 runJudgePanel helper 的源行（供 scaffold.ts 注入 .mjs）。
 */
export function runJudgePanelHelperLines(): string[] {
  return [...JUDGE_PANEL_HELPER_SRC]
}

// ============================================================================
// 可导出纯函数（供单测以 mock ctx 直接断言行为）
// ============================================================================

/**
 * 对抗式验证（可导出纯函数版）。
 *
 * 与 ADVERSARIAL_HELPER_SRC 中的 JS 函数行为完全一致。
 * 使用已导出的 parseVerdict（scaffold.ts）解析末行判定。
 *
 * @param ctx 运行时上下文（mock 或真实）
 * @param opts 对抗式选项
 * @returns 验证结果 { passed, refutedCount, threshold, reasons, artifact }
 *
 * Requirements: 3.3, 3.4, 3.5, 3.6
 */
export async function runAdversarial(ctx: any, opts: AdversarialOpts): Promise<AdversarialResult> {
  const { phaseTitle, artifact, fanout, threshold, prompt, agentType } = opts

  const refuters = await ctx.parallel(
    Array.from({ length: fanout }, (_, i) => () => {
      const o: any = { label: phaseTitle + " · 反驳者 " + (i + 1) + "/" + fanout, phase: phaseTitle }
      if (agentType) o.agentType = agentType
      return ctx.agent(prompt(artifact), o)
    }),
  )

  let refutedCount = 0
  const reasons: string[] = []
  for (const r of refuters) {
    if (r == null) { refutedCount += 1; continue }
    const v = parseVerdict(r)
    if (!v.evaluable) { refutedCount += 1; continue }
    if (!v.passed) { refutedCount += 1; reasons.push(...v.issues) }
  }

  const passed = refutedCount < threshold
  ctx.log("[adversarial] 反驳 " + refutedCount + "/" + fanout + "，阈值 " + threshold + " → " + (passed ? "通过" : "已杀掉"))
  return { passed, refutedCount, threshold, reasons, artifact }
}

/**
 * 挖到挖干（可导出纯函数版）。
 *
 * 与 FINDER_LOOP_HELPER_SRC 中的 JS 函数行为完全一致。
 *
 * @param ctx 运行时上下文（mock 或真实）
 * @param opts 挖到挖干选项
 * @returns 去重后的全部发现列表
 *
 * Requirements: 5.3, 5.4, 5.5, 5.6, 5.7
 */
export async function runFinderLoop(ctx: any, opts: FinderLoopOpts): Promise<string[]> {
  const { phaseTitle, convergenceRounds, maxRounds, prompt, parseItems, agentType } = opts

  const splitItems = parseItems || function splitRaw(raw: unknown): string[] {
    return String(raw == null ? "" : raw)
      .split(/\r?\n/)
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0 && s !== "[无新增]")
  }

  const seen = new Set<string>()
  const all: string[] = []
  let emptyRounds = 0
  let round = 0
  let truncated = false

  while (emptyRounds < convergenceRounds) {
    if (round >= maxRounds) { truncated = true; break }
    round += 1
    const o: any = { label: phaseTitle + " · finder 第" + round + "轮", phase: phaseTitle }
    if (agentType) o.agentType = agentType
    const raw = await ctx.agent(prompt([...seen].join("\n"), round), o)
    const fresh = (raw == null ? [] : splitItems(raw)).filter((it: string) => !seen.has(it))
    if (fresh.length === 0) { emptyRounds += 1; continue }
    emptyRounds = 0
    for (const it of fresh) { seen.add(it); all.push(it) }
  }

  if (truncated) ctx.log("[finder-loop] ⚠ 达上限 " + maxRounds + " 轮截断，可能仍有未挖完发现")
  ctx.log("[finder-loop] 发现 " + all.length + " 条，停止原因：" + (truncated ? "截断" : "收敛(" + convergenceRounds + "轮无新增)"))
  return all
}

/**
 * 评审团（可导出纯函数版）。
 *
 * 与 JUDGE_PANEL_HELPER_SRC 中的 JS 函数行为完全一致。
 *
 * @param ctx 运行时上下文（mock 或真实）
 * @param opts 评审团选项
 * @returns 综合后的最优方案文本；全降级时返回 ""
 *
 * Requirements: 7.3, 7.4, 7.5, 7.6, 7.7
 */
export async function runJudgePanel(ctx: any, opts: JudgePanelOpts): Promise<string> {
  const { phaseTitle, perspectives, draftPrompt, scorePrompt, synthesisPrompt, agentType } = opts

  const mkOpts = (label: string) => {
    const o: any = { label, phase: phaseTitle }
    if (agentType) o.agentType = agentType
    return o
  }

  const drafts = await ctx.parallel(
    perspectives.map((p, i) => () => ctx.agent(draftPrompt(p), mkOpts(phaseTitle + " · 起草[" + p + "]"))),
  )

  const idx = drafts
    .map((d: unknown, i: number) => ({ d, p: perspectives[i] }))
    .filter((x: { d: unknown; p: string }) => x.d != null)

  if (idx.length === 0) {
    ctx.log("[judge-panel] ⚠ 全部草稿降级，返回空结论")
    return ""
  }

  const scores = await ctx.parallel(
    idx.map((x: { d: unknown }, i: number) => () =>
      ctx.agent(scorePrompt(x.d), mkOpts(phaseTitle + " · 评分 " + (i + 1))),
    ),
  )

  const scoredText = idx
    .map((x: { d: unknown; p: string }, i: number) =>
      "=== [" + x.p + "] ===\n" +
      (typeof x.d === "string" ? x.d : JSON.stringify(x.d, null, 2)) +
      "\n--- 评分 ---\n" +
      (scores[i] == null ? "（评分缺失）" : String(scores[i])),
    )
    .join("\n\n")

  ctx.log("[judge-panel] " + idx.length + " 个候选方案完成评分")

  const best = await ctx.agent(synthesisPrompt(scoredText), mkOpts(phaseTitle + " · 综合最优"))
  return best == null ? scoredText : best
}