/**
 * RSI Analyze — CLI runner untuk RSI Engine components
 *
 * Menjalankan siklus analisis satu iterasi menggunakan tiga komponen RSI
 * yang sudah ada: AsymmetryEngine, TopologyMapper, ChannelMeter.
 *
 * Bukan infinite loop — setiap run adalah satu langkah atomik (MUEL H7).
 * State disimpan ke .rsi-cache/state.json untuk iterasi berikutnya.
 *
 * Usage:
 *   bun run rsi:analyze               # satu iterasi analisis
 *   bun run rsi:analyze --reset       # hapus state, mulai dari awal
 *   bun run rsi:analyze --json        # output dalam format JSON
 */

import path from "path"
import fs from "fs"
import {
  AsymmetryEngine,
  normalizeFractalDimension,
} from "../src/rsi/asymmetry-engine"
import {
  computeFailureTopology,
  extractFeatures,
  type FailurePoint,
} from "../src/rsi/topology-mapper"
import {
  measureChannelFidelity,
  type AgentKnowledgeState,
} from "../src/rsi/channel-meter"

// ── Paths ────────────────────────────────────────────────────────────────────

const CACHE_DIR = path.join("src", "evolution-rsi", ".rsi-cache")
const STATE_FILE = path.join(CACHE_DIR, "state.json")

// ── Persisted State Schema ────────────────────────────────────────────────────

interface RSIState {
  version: number
  previousAgent: AgentKnowledgeState | null
  failureHistory: Array<{ errorType: string; errorMessage: string; input: string }>
  iterationCount: number
  createdAt: number
  updatedAt: number
}

function loadState(): RSIState {
  if (fs.existsSync(STATE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as RSIState
    } catch {
      // State file corrupted — start fresh (explicit, not silenced: MUEL H4)
      console.warn("[RSI] State file unreadable — resetting to initial state.")
    }
  }
  return {
    version: 1,
    previousAgent: null,
    failureHistory: [],
    iterationCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

function saveState(state: RSIState): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8")
}

// ── Sample Failures (seeded untuk demo; diganti dengan fuzz output asli) ─────

const DEMO_FAILURES: Array<{ errorType: string; errorMessage: string; input: string }> = [
  { errorType: "TypeError", errorMessage: "Cannot read properties of undefined", input: "null input to parser" },
  { errorType: "RangeError", errorMessage: "Maximum call stack size exceeded", input: "deep recursive object" },
  { errorType: "SyntaxError", errorMessage: "Unexpected token in JSON", input: '{ broken: json }' },
  { errorType: "TypeError", errorMessage: "Cannot read properties of null", input: "null reference in handler" },
  { errorType: "AssertionError", errorMessage: "Expected true, got false", input: "boundary condition at index 0" },
]

// ── Main ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const flagReset = args.includes("--reset")
const flagJson = args.includes("--json")

if (flagReset && fs.existsSync(STATE_FILE)) {
  fs.rmSync(STATE_FILE, { force: true })
  console.log("[RSI] State reset. Run again to start fresh iteration.")
  process.exit(0)
}

const state = loadState()
state.iterationCount++

// 1. Topology — compute failure geometry from accumulated history
const allFailureRecords = [...state.failureHistory, ...DEMO_FAILURES]
const failurePoints: FailurePoint[] = allFailureRecords.map((f) => ({
  input: f.input,
  errorType: f.errorType,
  errorMessage: f.errorMessage,
  features: extractFeatures(f.input, f.errorType, f.errorMessage),
}))

const topology = computeFailureTopology(failurePoints)

// 2. AsymmetryEngine — feed current signals, compute push target
const engine = new AsymmetryEngine()
engine.updateSignal("boundaryFractalDimension", normalizeFractalDimension(topology.fractalDimension))

// 3. ChannelMeter — measure knowledge transfer if we have a previous agent state
const currentAgent: AgentKnowledgeState = {
  agentId: "opencode-rsi",
  version: `v${state.iterationCount}`,
  testOutcomes: Object.fromEntries(
    allFailureRecords.map((f, i) => [`test-${i}`, f.errorType !== "AssertionError"]),
  ),
  metricValues: {
    fractalDimension: topology.fractalDimension,
    clusterCount: topology.clusters.length,
    informationDensity: topology.informationDensity,
  },
  activeStrategies: topology.clusters.map((_, i) => `cluster-strategy-${i}`),
  timestamp: Date.now(),
}

const transfer = state.previousAgent
  ? measureChannelFidelity(state.previousAgent, currentAgent)
  : null

// Feed channelLoss into engine if available
if (transfer) {
  engine.updateSignal("channelLoss", transfer.channelLoss)
}

const iterationTarget = engine.compute()

// ── Output ────────────────────────────────────────────────────────────────────

if (flagJson) {
  console.log(
    JSON.stringify(
      {
        iteration: state.iterationCount,
        topology: {
          boundaryType: topology.boundaryType,
          fractalDimension: topology.fractalDimension,
          clusterCount: topology.clusters.length,
          exploitableStructure: topology.exploitableStructure,
          informationDensity: topology.informationDensity,
        },
        transfer: transfer
          ? {
              fromVersion: transfer.fromVersion,
              toVersion: transfer.toVersion,
              knowledgeRetained: transfer.knowledgeRetained,
              channelLoss: transfer.channelLoss,
              testsRegressed: transfer.testsRegressed,
            }
          : null,
        asymmetry: {
          pushTarget: iterationTarget.pushTarget,
          urgency: iterationTarget.urgency,
          dominantSignal: iterationTarget.dominantSignal,
          asymmetryScore: iterationTarget.asymmetryScore,
          rationale: iterationTarget.rationale,
          recommendation: iterationTarget.recommendation,
        },
      },
      null,
      2,
    ),
  )
} else {
  const line = "─".repeat(60)
  console.log(`\n${line}`)
  console.log(` 🔬 RSI ANALYZE — Iteration ${state.iterationCount}`)
  console.log(line)

  console.log("\n📐 FAILURE TOPOLOGY")
  console.log(`   Boundary Type      : ${topology.boundaryType}`)
  console.log(`   Fractal Dimension  : ${topology.fractalDimension.toFixed(4)}`)
  console.log(`   Clusters           : ${topology.clusters.length}`)
  console.log(`   Exploitable        : ${topology.exploitableStructure ? "YES ✓" : "no"}`)
  console.log(`   Info Density       : ${topology.informationDensity.toFixed(4)}`)

  if (transfer) {
    console.log("\n📡 CHANNEL FIDELITY  (v" + (state.iterationCount - 1) + " → v" + state.iterationCount + ")")
    console.log(`   Knowledge Retained : ${(transfer.knowledgeRetained * 100).toFixed(1)}%`)
    console.log(`   Channel Loss       : ${(transfer.channelLoss * 100).toFixed(1)}%`)
    console.log(`   Test Regressions   : ${transfer.testsRegressed.length}`)
    console.log(`   Strategies Lost    : ${transfer.strategiesLost.length}`)
    console.log(`   Net Info Change    : ${transfer.netInformationChange >= 0 ? "+" : ""}${transfer.netInformationChange.toFixed(3)} bits`)
  } else {
    console.log("\n📡 CHANNEL FIDELITY  : (no previous version — baseline established)")
  }

  console.log("\n🎯 ASYMMETRY ENGINE")
  console.log(`   Push Target        : ${iterationTarget.pushTarget}`)
  console.log(`   Urgency            : ${(iterationTarget.urgency * 100).toFixed(1)}%`)
  console.log(`   Dominant Signal    : ${iterationTarget.dominantSignal}`)
  console.log(`   Asymmetry Score    : ${iterationTarget.asymmetryScore.toFixed(4)}`)
  console.log(`\n   Rationale: ${iterationTarget.rationale}`)
  console.log(`\n   ➜ Next Action: ${iterationTarget.recommendation}`)
  console.log(`\n${line}\n`)
}

// ── Persist state for next iteration ─────────────────────────────────────────

state.previousAgent = currentAgent
state.updatedAt = Date.now()
saveState(state)
