#!/usr/bin/env bun

import { execSync, spawnSync } from "child_process"
import { readFileSync, writeFileSync, mkdirSync } from "fs"
import { containsMaliciousPatterns, containsPrototypePollution, checkPath, assertEvolutionPath, detectConvergence } from "../src/muel/rsi-guard"
import { createLLMClient, StubLLM } from "../src/muel/stub-llm"
import { AgentArchive } from "../src/muel/agent-archive"
import { Auditor, createDefaultAuditor, extractExportedFunctions } from "../src/muel/auditor"
import { SFSOptimizer } from "../src/muel/sfs-optimizer"
import { computeDiversity } from "../src/muel/types"
import type { LLMClient } from "../src/muel/stub-llm"
import { computeFailureTopology, extractFeatures } from "../src/rsi/topology-mapper"
import { measureChannelFidelity, type AgentKnowledgeState } from "../src/rsi/channel-meter"
import { AsymmetryEngine, normalizeFractalDimension, type IterationTarget } from "../src/rsi/asymmetry-engine"
import type { FuzzResult } from "../src/muel/fuzz-attacker"
import type { CCFEvaluation } from "../src/muel/ccf/types"

function logAsymmetryTarget(engine: AsymmetryEngine): IterationTarget {
  const target = engine.compute()
  console.log(`[RSI] Iteration ${target.iteration}`)
  console.log(`[RSI] Push target: ${target.pushTarget} (urgency: ${target.urgency.toFixed(2)})`)
  console.log(`[RSI] Dominant signal: ${target.dominantSignal}`)
  console.log(`[RSI] Signals active: ${target.availableSignals}/${target.totalSignalSlots}`)
  console.log(`[RSI] Next action: ${target.recommendation}`)
  if (target.pushTarget === "EMERGENCY_KNOWLEDGE_RECOVERY") {
    throw new Error(`[RSI] EMERGENCY HALT: ${target.rationale}`)
  }
  return target
}

const MAX_ITERATIONS = 10
const EVOLUTION_DIR = "src/evolution-rsi"

const args = process.argv.slice(2)
const goalIdx = args.indexOf("--goal")
const specIdx = args.indexOf("--spec")
const fileIdx = args.indexOf("--file")
const FILE_PATH = fileIdx !== -1 ? args[fileIdx + 1] : undefined

if (!FILE_PATH && (goalIdx === -1 || !args[goalIdx + 1])) {
  console.error("Usage:")
  console.error("  bun run scripts/rsi-engine.ts --goal \"tujuan\" [--spec path]")
  console.error("  bun run scripts/rsi-engine.ts --file batch.json")
  process.exit(1)
}

let GOAL = goalIdx !== -1 ? args[goalIdx + 1] : ""
let SPEC_PATH: string | undefined = specIdx !== -1 ? args[specIdx + 1] : undefined

const TEST_MODE = process.env.TEST_MODE === "true"

interface BatchGoal { goal: string; spec?: string }

function loadBatch(filePath: string): BatchGoal[] {
  const raw = readFileSync(filePath, "utf8")
  return JSON.parse(raw)
}

function runTests(cmd: string[], cwd?: string): { pass: boolean; output: string; count: number } {
  const result = spawnSync(cmd[0], cmd.slice(1), { cwd, encoding: "utf8", timeout: 120_000 })
  const output = (result.stdout ?? "") + (result.stderr ?? "")
  const countMatch = output.match(/(\d+)\s+pass/)
  const failMatch = output.match(/(\d+)\s+fail/)
  return {
    pass: result.status === 0,
    output,
    count: countMatch ? parseInt(countMatch[1]) : 0,
  }
}

function runSpecOracle(): { pass: boolean; fraction: number; output: string } {
  if (!SPEC_PATH) {
    console.log("ℹ️  Tidak ada --spec file. Spec oracle dilewati (WARNING: risiko metric gaming)")
    return { pass: true, fraction: 0.5, output: "no spec provided" }
  }
  const result = spawnSync("bun", ["test", SPEC_PATH], { encoding: "utf8", timeout: 30_000 })
  const output = (result.stdout ?? "") + (result.stderr ?? "")
  const passLines = (output.match(/\(pass\).*$/gm) ?? []) as string[]
  const failLines = (output.match(/\(fail\).*$/gm) ?? []) as string[]
  const namedTests = passLines.concat(failLines).filter(l => !l.includes("(unnamed)"))
  const passed = namedTests.filter(l => l.includes("(pass)")).length
  const total = namedTests.length
  const pass = passed > 0 && passed === total
  return { pass, fraction: total > 0 ? passed / total : 0, output }
}

function rollbackEvolution(): void {
  try {
    execSync(`git checkout -- ${EVOLUTION_DIR}`, { encoding: "utf8" })
    console.log("↩️  Rollback: src/evolution-rsi/ dikembalikan")
  } catch {
    console.log("ℹ️  Tidak ada perubahan git untuk di-revert")
  }
}

function parseFiles(response: string): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = []
  const re = /===FILE:\s*(.+?)===\n([\s\S]*?)===END===/g
  let match
  while ((match = re.exec(response)) !== null) {
    const filePath = match[1].trim()
    try {
      checkPath(filePath)
      assertEvolutionPath(filePath)
      files.push({ path: filePath, content: match[2].trim() })
    } catch (e) {
      console.error(`⛔ Guard: ${(e as Error).message}`)
    }
  }
  return files
}

async function executeGoal(
  goal: string,
  specPath: string | undefined,
  archive: AgentArchive,
  mainLLM: LLMClient,
  auditor: Auditor,
  baseline: { count: number },
  sfsOptimizer: SFSOptimizer,
): Promise<{ success: boolean; combinedScore: number }> {
  GOAL = goal
  SPEC_PATH = specPath

  console.log(`\n${"=".repeat(60)}`)
  console.log(`🎯 Goal: "${GOAL}"`)
  console.log(`📋 Spec: ${SPEC_PATH ?? "tidak ada (WARNING: risiko metric gaming)"}`)
  console.log(`${"=".repeat(60)}\n`)

  const scoreHistory: number[] = []
  const asymmetryEngine = new AsymmetryEngine()
  let previousAgentState: AgentKnowledgeState | null = null

  for (let i = 1; i <= MAX_ITERATIONS; i++) {
    console.log(`\n━━━ Iterasi ${i}/${MAX_ITERATIONS} ━━━`)

    // STEP 1: SFS Optimization (Scattering + Foresting + Scouting)
    console.log(`🌲 [1/7] SFS Scattering & Foresting...`)
    const converging = scoreHistory.length >= 3
      ? scoreHistory.slice(-3).every((s, i, a) => i === 0 || s <= a[i - 1])
      : false
    let response: string
    try {
      const sfsResult = await sfsOptimizer.optimize(GOAL, i, archive, mainLLM, converging)
      response = sfsResult.content
      console.log(`     🌱 ${sfsResult.seeds} seeds | ${sfsResult.strategy} strategy`)
    } catch (e) {
      console.error(`❌ SFS error: ${(e as Error).message}`)
      break
    }

    // STEP 1b: Parse and write files
    console.log("📄 [1b/7] Parsing files...")
    const files = parseFiles(response)
    if (files.length === 0) {
      console.log(`⚠️  Tidak ada file valid dari LLM`)
      sfsOptimizer.recordInsight(i, false, "tidak ada file valid")
      continue
    }
    const writtenFiles: string[] = []
    for (const f of files) {
      writeFileSync(f.path, f.content, "utf8")
      writtenFiles.push(f.path)
      console.log(`     ${f.path}`)
    }

    // STEP 3: MUEL tests
    console.log("🧪 [3/7] MUEL tests...")
    const muelResult = runTests(["bun", "test", "test/muel/", "--timeout", "30000"])
    if (!muelResult.pass) {
      console.log(`❌ MUEL FAIL (${muelResult.count}/${baseline.count})`)
      rollbackEvolution()
      sfsOptimizer.recordInsight(i, false, "MUEL FAIL")
      const diversityScore = computeDiversity(writtenFiles, archive.getAllVersions())
      archive.record({
        goal: GOAL, iteration: i, filesCreated: writtenFiles,
        muelCount: muelResult.count, muelBaseline: baseline.count,
        specFraction: 0, combinedScore: 0,
        auditVerdict: "UNSAFE", approved: false,
        diversityScore,
        notes: `MUEL FAIL: ${muelResult.output.slice(0, 100)}`,
        timestamp: new Date().toISOString(),
      })
      continue
    }
    console.log(`✅ MUEL: ${muelResult.count} PASS`)

    // STEP 4: Spec oracle
    console.log("🎯 [4/7] Spec oracle...")
    const specResult = runSpecOracle()
    if (!specResult.pass) {
      console.log(`❌ SPEC ORACLE FAIL (${(specResult.fraction * 100).toFixed(0)}%) — kemungkinan metric gaming`)
      rollbackEvolution()
      sfsOptimizer.recordInsight(i, false, `SPEC FAIL (${(specResult.fraction * 100).toFixed(0)}%)`)
      const diversityScore = computeDiversity(writtenFiles, archive.getAllVersions())
      archive.record({
        goal: GOAL, iteration: i, filesCreated: writtenFiles,
        muelCount: muelResult.count, muelBaseline: baseline.count,
        specFraction: specResult.fraction,
        combinedScore: muelResult.count * specResult.fraction,
        auditVerdict: "UNSAFE", approved: false,
        diversityScore,
        notes: `SPEC FAIL: ${specResult.output.slice(0, 100)}`,
        timestamp: new Date().toISOString(),
      })
      continue
    }
    console.log(`✅ Spec: ${(specResult.fraction * 100).toFixed(0)}% PASS`)

    // STEP 5: Adversarial audit
    console.log("🔍 [5/7] Adversarial audit...")
    const allCode = writtenFiles.map(f => {
      try { return readFileSync(f, "utf8") } catch { return "" }
    }).join("\n\n")
    const functions = extractExportedFunctions(allCode)
    const auditResult = await auditor.audit(allCode, GOAL, functions)
    console.log(`     Verdict: ${auditResult.verdict}`)
    for (const [k, v] of Object.entries(auditResult.checks)) {
      console.log(`     [${k}]: ${v}`)
    }

    if (auditResult.verdict === "UNSAFE") {
      console.log(`❌ AUDIT UNSAFE — rollback`)
      rollbackEvolution()
      sfsOptimizer.recordInsight(i, false, "AUDIT UNSAFE")
      const diversityScore = computeDiversity(writtenFiles, archive.getAllVersions())
      archive.record({
        goal: GOAL, iteration: i, filesCreated: writtenFiles,
        muelCount: muelResult.count, muelBaseline: baseline.count,
        specFraction: specResult.fraction,
        combinedScore: muelResult.count * specResult.fraction,
        auditVerdict: "UNSAFE", approved: false,
        diversityScore,
        notes: `AUDIT UNSAFE: ${auditResult.reasoning.slice(0, 100)}`,
        timestamp: new Date().toISOString(),
      })
      continue
    }

    // STEP 5.5: Fuzz Attacker (before Improvement Card)
    let fuzzTarget: ((input: unknown[]) => unknown) | undefined
    let fuzzResult: FuzzResult | undefined
    for (const f of writtenFiles) {
      if (!f.includes("src/evolution-rsi/")) continue
      try {
        const mod = await import("." + f.replace(/\.ts$/, ""))
        const fn = Object.values(mod).find(
          (v): v is ((...args: unknown[]) => unknown) => typeof v === "function",
        )
        if (fn) { fuzzTarget = fn; break }
      } catch { /* skip non-importable files */ }
    }

    if (!fuzzTarget) {
      console.log(`🐙 [5.5/7] Fuzz Attacker: no fuzzable function found, skipping`)
    } else {
      console.log(`🐙 [5.5/7] Fuzz Attacker...`)
      const { FuzzAttacker } = await import("../src/muel/fuzz-attacker")
      const attacker = new FuzzAttacker()
      const fuzzInputs = attacker.generateInputs(100)
      fuzzResult = attacker.fuzzTest(fuzzTarget, fuzzInputs)
      console.log(`     ${fuzzResult.passed}/${fuzzResult.total} passed, ${fuzzResult.failed} failed`)
      if (fuzzResult.failed > 0) {
        console.log(`⚠️  NEEDS_REVIEW: fuzz crashes detected`)
        if (fuzzResult.errors.length > 0) {
          console.log(`     Errors: ${fuzzResult.errors.slice(0, 3).join(", ")}`)
        }
        rollbackEvolution()
        const diversityScore = computeDiversity(writtenFiles, archive.getAllVersions())
        archive.record({
          goal: GOAL, iteration: i, filesCreated: writtenFiles,
          muelCount: muelResult.count, muelBaseline: baseline.count,
          specFraction: specResult.fraction, combinedScore: 0,
          auditVerdict: "NEEDS_REVIEW", approved: false,
          diversityScore,
          notes: `FUZZ FAIL: ${fuzzResult.failed}/${fuzzResult.total} crashed — ${fuzzResult.errors.slice(0, 2).join("; ")}`,
          timestamp: new Date().toISOString(),
        })
        continue
      }
      console.log(`✅ Fuzz: ${fuzzResult.passed}/${fuzzResult.total} passed`)
    }

    // STEP 5b: Topology mapping (after Fuzz, before Improvement Card)
    if (fuzzTarget && fuzzResult) {
      const failures = fuzzResult.failures.map(f => ({
        input: f.input,
        errorType: f.error.constructor.name,
        errorMessage: f.error.message,
        features: extractFeatures(f.input, f.error.constructor.name, f.error.message),
      }))
      const topology = computeFailureTopology(failures)
      const normalizedD = normalizeFractalDimension(topology.fractalDimension)
      asymmetryEngine.updateSignal("boundaryFractalDimension", normalizedD)
      console.log(
        `     Topology: D=${topology.fractalDimension.toFixed(2)}, clusters=${topology.clusters.length}, boundary=${topology.boundaryType}`,
      )
    }

    // STEP 5.7: CCF Evaluation (after Fuzz + Topology, before Improvement Card)
    console.log("🌀 [5.7/7] Counterfactual Consistency Field...")
    const { CCFEngine } = await import("../src/muel/ccf")
    const { MathWorldModel } = await import("../src/muel/ccf/world-models")
    const { EvidenceWorldModel } = await import("../src/muel/ccf/world-models")
    const { LogicalWorldModel } = await import("../src/muel/ccf/world-models")
    const { SemanticWorldModel } = await import("../src/muel/ccf/world-models")
    const { ManipulationWorldModel } = await import("../src/muel/ccf/world-models")
    const ccf = new CCFEngine([
      new MathWorldModel(),
      new EvidenceWorldModel(),
      new LogicalWorldModel(),
      new SemanticWorldModel(),
      new ManipulationWorldModel(),
    ])
    const ccfResult: CCFEvaluation = await ccf.evaluate(allCode, { goal: GOAL })
    console.log(`     Consistency: ${ccfResult.consistency.overallConsistency.toFixed(2)}`)
    console.log(`     Verdict: ${ccfResult.verdict}`)
    if (ccfResult.verdict === "REJECTED") {
      console.log(`     Reason: ${ccfResult.reason}`)
      rollbackEvolution()
      const diversityScore = computeDiversity(writtenFiles, archive.getAllVersions())
      archive.record({
        goal: GOAL, iteration: i, filesCreated: writtenFiles,
        muelCount: muelResult.count, muelBaseline: baseline.count,
        specFraction: specResult.fraction, combinedScore: 0,
        auditVerdict: "NEEDS_REVIEW", approved: false,
        diversityScore,
        notes: `CCF REJECT: ${ccfResult.reason}`,
        timestamp: new Date().toISOString(),
      })
      continue
    }
    console.log(`✅ CCF: ${ccfResult.consistency.overallConsistency.toFixed(2)} consistency`)

    const combinedScore = muelResult.count * specResult.fraction

    // STEP 6: Improvement card
    console.log(`\n📊 [6/7] IMPROVEMENT CARD:`)
    console.log(`  MUEL: ${baseline.count} → ${muelResult.count} tests`)
    console.log(`  Spec: ${(specResult.fraction * 100).toFixed(0)}%`)
    console.log(`  Combined Score: ${combinedScore.toFixed(3)} (vs baseline 0)`)
    console.log(`  Audit: ${auditResult.verdict}`)
    console.log(`  Files: ${writtenFiles.join(", ")}`)
    console.log(`  Archive: ${archive.getSummary(GOAL.slice(0, 20))}`)

    // STEP 7: Human Final Gate
    let answer = "ACC"
    if (!TEST_MODE) {
      const readline = await import("readline")
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      answer = await new Promise<string>(resolve => {
        rl.question(`\n⚖️  Chief Architect — ACC atau REJECT? `, resolve)
      })
      rl.close()
    } else {
      console.log(`⚖️  [TEST_MODE] Auto-ACC`)
    }

    if (answer.trim().toUpperCase() === "ACC") {
      const diversityScore = computeDiversity(writtenFiles, archive.getAllVersions())
      archive.record({
        goal: GOAL, iteration: i, filesCreated: writtenFiles,
        muelCount: muelResult.count, muelBaseline: baseline.count,
        specFraction: specResult.fraction, combinedScore,
        auditVerdict: auditResult.verdict,
        approved: true,
        diversityScore,
        notes: `APPROVED. Functions: ${functions.join(", ")}`,
        timestamp: new Date().toISOString(),
      })
      sfsOptimizer.recordInsight(i, true, `approved: ${functions.join(", ")}`)
      scoreHistory.push(combinedScore)

      // Step 7b: Channel fidelity + Asymmetry Engine
      const currentAgentState: AgentKnowledgeState = {
        agentId: `agent-${GOAL.slice(0, 20)}`,
        version: `iter-${i}`,
        testOutcomes: Object.fromEntries(Array.from({ length: muelResult.count }, (_, idx) => [`test-${idx}`, true])),
        metricValues: {
          passRate: muelResult.count / Math.max(1, baseline.count),
          compileRate: 1.0,
          latencyMs: 0,
        },
        activeStrategies: functions ?? [],
        timestamp: Date.now(),
      }
      if (previousAgentState !== null) {
        const transfer = measureChannelFidelity(previousAgentState, currentAgentState)
        asymmetryEngine.updateSignal("channelLoss", transfer.channelLoss)
        console.log(`     Channel: ${(transfer.knowledgeRetained * 100).toFixed(1)}% retained, ${transfer.strategiesLost.length} strategies lost`)
      }
      previousAgentState = currentAgentState

      const iterationTarget = logAsymmetryTarget(asymmetryEngine)
      if (iterationTarget.pushTarget === "EMERGENCY_KNOWLEDGE_RECOVERY") {
        throw new Error(`[RSI] EMERGENCY HALT: ${iterationTarget.rationale}`)
      }

      console.log(`\n🏆 Goal "${GOAL}" selesai dengan persetujuan Chief Architect!`)
      console.log(`📦 Disimpan ke agent archive (entry #${archive.getAllVersions().length})`)
      return { success: true, combinedScore }
    } else {
      console.log(`\n↩️  REJECTED. Rollback...`)
      rollbackEvolution()
      const diversityScore = computeDiversity(writtenFiles, archive.getAllVersions())
      archive.record({
        goal: GOAL, iteration: i, filesCreated: writtenFiles,
        muelCount: muelResult.count, muelBaseline: baseline.count,
        specFraction: specResult.fraction, combinedScore,
        auditVerdict: auditResult.verdict,
        approved: false,
        diversityScore,
        notes: `REJECTED oleh Chief Architect`,
        timestamp: new Date().toISOString(),
      })
      sfsOptimizer.recordInsight(i, false, "REJECTED oleh Chief Architect")
      scoreHistory.push(combinedScore)
      logAsymmetryTarget(asymmetryEngine)
    }
  }

  console.log(`\n⚠️  RSI: ${MAX_ITERATIONS} iterasi habis untuk "${GOAL}".`)
  console.log(archive.getSummary(GOAL.slice(0, 20)))
  return { success: false, combinedScore: 0 }
}

async function main(): Promise<void> {
  console.log(`\n🧬 RSI Engine v2.0 — ${TEST_MODE ? "MODE STUB (DRY RUN)" : "MODE REAL API"}`)
  console.log("")

  mkdirSync(EVOLUTION_DIR, { recursive: true })

  const baseline = runTests(["bun", "test", "test/muel/", "--timeout", "30000"])
  if (!baseline.pass) {
    console.error(`❌ MUEL baseline FAIL sebelum RSI. Perbaiki dulu.`)
    process.exit(1)
  }
  console.log(`✅ Baseline: ${baseline.count} MUEL tests PASS\n`)

  const archive = new AgentArchive()
  const mainLLM: LLMClient = createLLMClient()
  const auditor: Auditor = TEST_MODE ? createDefaultAuditor() : new Auditor(createLLMClient())
  const sfsOptimizer = new SFSOptimizer()
  const bestAgent = archive.selectBestAgent()
  if (bestAgent) {
    console.log(`📈 Best historical agent: skor ${bestAgent.combinedScore.toFixed(3)}`)
  }

  const batch = FILE_PATH ? loadBatch(FILE_PATH) : []
  const results: Array<{ goal: string; success: boolean; combinedScore: number }> = []

  if (batch.length > 0) {
    console.log(`📦 Batch mode: ${batch.length} goals from ${FILE_PATH}\n`)
    for (const entry of batch) {
      const r = await executeGoal(entry.goal, entry.spec, archive, mainLLM, auditor, baseline, sfsOptimizer)
      results.push({ goal: entry.goal, ...r })
    }
  } else {
    const r = await executeGoal(GOAL, SPEC_PATH, archive, mainLLM, auditor, baseline, sfsOptimizer)
    results.push({ goal: GOAL, ...r })
  }

  const ok = results.filter(r => r.success).length
  const failCount = results.filter(r => !r.success).length
  console.log(`\n${"=".repeat(60)}`)
  console.log(`📊 BATCH SUMMARY`)
  console.log(`${"=".repeat(60)}`)
  for (const r of results) {
    const icon = r.success ? "✅" : "❌"
    const score = r.success ? r.combinedScore.toFixed(3) : "FAILED"
    console.log(`  ${icon} "${r.goal.slice(0, 45)}": ${score}`)
  }
  console.log(`${"=".repeat(60)}`)
  console.log(`  Total: ${results.length} | Success: ${ok} | Fail: ${failCount}`)
  console.log(`${"=".repeat(60)}`)
}

main().catch(e => {
  console.error("RSI Engine fatal error:", e)
  rollbackEvolution()
  process.exit(1)
})
