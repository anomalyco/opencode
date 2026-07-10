import { AgentEngine } from "../src/agent/engine"
import { EngineDatabase } from "../src/agent/engine/db"
import type { ReplayMode } from "../src/agent/engine/replay"

const db = new EngineDatabase(":memory:")
await db.initialize()

const engine = new AgentEngine({ maxSteps: 50, tokenBudget: 1_000_000 })
let currentSession = ""

function fail(msg: string): never {
  console.error(`ERROR: ${msg}`)
  process.exit(1)
}

function ok(msg: string) {
  console.log(`  ${msg}`)
}

const cmd = process.argv[2]
const arg = process.argv[3]

switch (cmd) {
  case "status": {
    const snap = engine.getSnapshot()
    console.log(JSON.stringify(snap, null, 2))
    break
  }

  case "init": {
    const goal = arg || process.argv.slice(3).join(" ") || "default task"
    currentSession = `session-${Date.now()}`
    await engine.initialize(currentSession, goal)
    ok(`Session initialized: ${currentSession}`)
    ok(`Goal: ${goal}`)
    break
  }

  case "run": {
    if (!currentSession) {
      currentSession = `session-${Date.now()}`
      await engine.initialize(currentSession, "run from CLI")
    }
    const goal = arg || "execute task"
    const caps = engine.registry.getAll()

    if (caps.length === 0) {
      // Register default capabilities
      const { DAGGenerator } = await import("../src/agent/engine/llm/dag-generator")
      fail("No capabilities registered. Use 'engine register-tools' first or register via config.")
    }

    await engine.plan(goal, caps)

    let completed = false
    for (let i = 0; i < 50 && !completed; i++) {
      await engine.createCheckpoint()
      const r = await engine.executeStep()
      completed = r.completed
      ok(`Step ${i + 1}: ${r.completed ? "done" : "running"} (${r.allSucceeded ? "success" : "in-progress"})`)
    }

    const snap = engine.getSnapshot()
    console.log(JSON.stringify(snap, null, 2))
    break
  }

  case "replay": {
    if (!arg) fail("Usage: engine replay <session-id> [mode=dry-run|read-only|full]")
    const mode = (process.argv[4] || "dry-run") as ReplayMode
    const events = db.queryEvents(arg)
    if (events.length === 0) {
      fail(`No events found for session: ${arg}. Use 'engine record' to record events first.`)
    }
    const result = await engine.replay(mode, events.map((e) => ({
      event_id: e.event_id,
      session_id: e.session_id,
      parent_event_id: e.parent_event_id,
      event_type: e.event_type,
      payload: typeof e.payload === "string" ? JSON.parse(e.payload as string) : (e.payload as Record<string, unknown>),
      sequence_index: e.sequence_index,
      timestamp: e.timestamp,
    })))
    console.log(JSON.stringify(result, null, 2))
    break
  }

  case "fork": {
    if (!arg) fail("Usage: engine fork <branch-name>")
    const branch = await engine.fork(arg)
    console.log(JSON.stringify(branch, null, 2))
    break
  }

  case "pause": {
    await engine.pause()
    ok("Session paused")
    break
  }

  case "resume": {
    const result = await engine.resume(arg)
    console.log(result ? JSON.stringify(result, null, 2) : "No checkpoint to resume from")
    break
  }

  case "shutdown": {
    await engine.shutdown()
    ok("Engine shut down")
    db.close()
    break
  }

  case "register-tools": {
    ok("Use opencode.jsonc to configure engine tools")
    ok("Example: { \"engine\": { \"enabled\": true, \"tools\": [...] } }")
    break
  }

  default: {
    console.log("Fengru Engine CLI")
    console.log("  engine status                    Show engine state")
    console.log("  engine init <goal>               Initialize session")
    console.log("  engine run [goal]                Run with current goal")
    console.log("  engine replay <session> [mode]   Replay session events")
    console.log("  engine fork <branch-name>        Fork current session")
    console.log("  engine pause                     Pause session")
    console.log("  engine resume [checkpoint-id]    Resume from checkpoint")
    console.log("  engine shutdown                  Clean shutdown")
    console.log("  engine register-tools            Show tool registration info")
    break
  }
}
