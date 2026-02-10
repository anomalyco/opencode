#!/usr/bin/env bun
/**
 * Multi-Model Agent Team Integration Test
 *
 * Tests that team_spawn's `model` parameter correctly routes teammates
 * to different foundational models (Claude, Gemini, OpenAI) and that
 * cross-model coordination works via team messaging.
 *
 * This is a standalone script (run with `bun run`, NOT `bun test`)
 * because it needs real provider credentials via auth plugins.
 *
 * Usage:
 *   cd packages/opencode
 *   bun run test/team/team-multi-model.ts
 *
 * Prerequisites:
 *   - opencode-anthropic-auth plugin (Anthropic OAuth)
 *   - opencode-gemini-auth plugin (Google OAuth)
 *   - opencode-openai-codex-auth plugin (OpenAI OAuth)
 *   - Valid credentials in ~/.local/share/opencode/auth.json
 *   - OPENCODE_EXPERIMENTAL_AGENT_TEAMS=1 (set below)
 */

import path from "path"
import os from "os"
import fs from "fs/promises"
import { $ } from "bun"

// ---------- Environment setup ----------
process.env["OPENCODE_EXPERIMENTAL_AGENT_TEAMS"] = "1"
process.env["OPENCODE_DISABLE_LSP_DOWNLOAD"] = "true"
process.env["OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER"] = "true"

// ---------- Imports (after env setup) ----------
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { Team, TeamTasks } from "../../src/team"
import { TeamMessaging } from "../../src/team/messaging"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageV2 } from "../../src/session/message-v2"
import { Identifier } from "../../src/id/id"
import { Plugin } from "../../src/plugin"
import { Provider } from "../../src/provider/provider"
import { Bus } from "../../src/bus"
import {
  TeamCreateTool,
  TeamSpawnTool,
  TeamMessageTool,
} from "../../src/tool/team"

Log.init({ print: true, dev: true, level: "INFO" })

// ---------- Test framework ----------
let passed = 0
let failed = 0
const errors: string[] = []
const startTime = Date.now()

function assert(condition: boolean, message: string) {
  if (!condition) {
    failed++
    errors.push(message)
    console.error(`  FAIL: ${message}`)
  } else {
    passed++
    console.log(`  PASS: ${message}`)
  }
}

function mockCtx(sessionID: string, messages: MessageV2.WithParts[] = []) {
  return {
    sessionID,
    messageID: Identifier.ascending("message"),
    agent: "general",
    abort: new AbortController().signal,
    messages,
    metadata: () => {},
    ask: async () => {},
  } as any
}

async function createTmpDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), "opencode-multimodel-" + Math.random().toString(36).slice(2))
  await fs.mkdir(dir, { recursive: true })
  await $`git init`.cwd(dir).quiet()
  await $`git commit --allow-empty -m "root"`.cwd(dir).quiet()
  return await fs.realpath(dir)
}

async function seedUserMessage(sessionID: string, providerID: string, modelID: string, text: string = "init") {
  const mid = Identifier.ascending("message")
  await Session.updateMessage({
    id: mid,
    sessionID,
    role: "user",
    agent: "general",
    model: { providerID, modelID },
    time: { created: Date.now() },
  })
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: mid,
    sessionID,
    type: "text",
    text,
  })
  return mid
}

async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs: number = 90000,
  intervalMs: number = 500,
  description: string = "condition",
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return true
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  console.error(`  TIMEOUT waiting for: ${description}`)
  return false
}

// ============================================================
// Main
// ============================================================

console.log("\n========== Multi-Model Agent Team Integration Test ==========\n")

const dir = await createTmpDir()

await Instance.provide({
  directory: dir,
  init: async () => {
    await Plugin.init()
  },
  fn: async () => {
    // ========== Phase 0: Discover available providers/models ==========
    console.log("--- Phase 0: Provider Discovery ---\n")

    const providers = await Provider.list()
    const providerNames = Object.keys(providers)
    console.log(`  Available providers: ${providerNames.join(", ")}`)

    for (const [pid, prov] of Object.entries(providers)) {
      const modelNames = Object.keys(prov.models).slice(0, 5)
      console.log(`  ${pid}: ${modelNames.join(", ")}${Object.keys(prov.models).length > 5 ? " ..." : ""}`)
    }

    // Determine which providers we can test
    const hasAnthropic = !!providers["anthropic"]
    const hasGoogle = !!providers["google"]
    const hasOpenAI = !!providers["openai"]

    console.log(`\n  Anthropic: ${hasAnthropic ? "YES" : "NO"}`)
    console.log(`  Google:    ${hasGoogle ? "YES" : "NO"}`)
    console.log(`  OpenAI:    ${hasOpenAI ? "YES" : "NO"}`)

    if (!hasAnthropic) {
      console.error("\n  ERROR: Anthropic provider required as team lead. Aborting.")
      process.exit(1)
    }

    const availableProviders: Array<{ providerID: string; modelID: string; label: string }> = []

    // Pick a model from each available provider
    if (hasAnthropic) {
      const models = Object.keys(providers["anthropic"].models)
      // Prefer a sonnet/haiku for cost
      const model = models.find((m) => m.includes("sonnet")) ?? models.find((m) => m.includes("haiku")) ?? models[0]
      availableProviders.push({ providerID: "anthropic", modelID: model, label: "Claude" })
      console.log(`\n  Lead model: anthropic/${model}`)
    }

    if (hasGoogle) {
      const models = Object.keys(providers["google"].models)
      const model = models.find((m) => m.includes("flash")) ?? models[0]
      availableProviders.push({ providerID: "google", modelID: model, label: "Gemini" })
      console.log(`  Gemini model: google/${model}`)
    }

    if (hasOpenAI) {
      const models = Object.keys(providers["openai"].models)
      // Prefer mini/nano for cost
      const model = models.find((m) => m.includes("mini")) ?? models.find((m) => m.includes("nano")) ?? models[0]
      availableProviders.push({ providerID: "openai", modelID: model, label: "OpenAI" })
      console.log(`  OpenAI model: openai/${model}`)
    }

    const numProviders = availableProviders.length
    console.log(`\n  Testing with ${numProviders} provider(s)\n`)

    if (numProviders < 2) {
      console.error("  WARNING: Need at least 2 providers for cross-model test. Only have 1.")
      console.error("  Running single-provider validation only.\n")
    }

    // ========== Phase 1: Validate model param on team_spawn ==========
    console.log("--- Phase 1: Model Parameter Validation ---\n")

    const leadProvider = availableProviders[0]
    const leadSession = await Session.create({})
    await seedUserMessage(leadSession.id, leadProvider.providerID, leadProvider.modelID)

    // Create team
    const createTool = await TeamCreateTool.init()
    await createTool.execute(
      {
        name: "multi-model-team",
        tasks: availableProviders.map((p, i) => ({
          id: `task-${i}`,
          content: `Task for ${p.label}`,
          priority: "medium" as const,
        })),
      },
      mockCtx(leadSession.id),
    )

    const team = await Team.get("multi-model-team")
    assert(team !== undefined, "Multi-model team created")

    // Test invalid model param
    const spawnTool = await TeamSpawnTool.init()
    const leadMsgs = await Session.messages({ sessionID: leadSession.id })

    const badModelResult = await spawnTool.execute(
      {
        name: "bad-model-test",
        prompt: "test",
        model: "fakeprovider/nonexistent-model-xyz",
      },
      mockCtx(leadSession.id, leadMsgs),
    )
    assert(badModelResult.title === "Error", "Invalid model rejected")
    assert(
      badModelResult.output.includes("Model not found") || badModelResult.output.includes("not found"),
      `Error message mentions model not found: "${badModelResult.output.slice(0, 120)}"`,
    )

    // Test valid model param format
    const validModel = `${leadProvider.providerID}/${leadProvider.modelID}`
    const validModelResult = await spawnTool.execute(
      {
        name: "valid-model-test",
        prompt: "Respond with exactly: MODEL VALIDATION OK. Do not use any tools.",
        model: validModel,
        claim_task: "task-0",
      },
      mockCtx(leadSession.id, leadMsgs),
    )
    assert(validModelResult.title.includes("Spawned"), "Valid model accepted")
    assert(
      validModelResult.output.includes(validModel),
      `Output shows model: "${validModelResult.output.slice(0, 200)}"`,
    )
    assert(
      validModelResult.metadata.model === validModel,
      `Metadata contains model: ${validModelResult.metadata.model}`,
    )

    // Verify member record has model
    const teamAfterSpawn = await Team.get("multi-model-team")
    const validMember = teamAfterSpawn!.members.find((m) => m.name === "valid-model-test")
    assert(validMember?.model === validModel, `Member record has model: ${validMember?.model}`)

    // Wait for this teammate to finish (validates the model actually works)
    console.log(`\n  Waiting for valid-model-test (${validModel}) to complete...`)
    const validDone = await waitFor(async () => {
      const t = await Team.get("multi-model-team")
      return t?.members.find((m) => m.name === "valid-model-test")?.status === "ready"
    }, 90000, 500, "valid-model-test to go idle")
    assert(validDone, `Teammate using ${validModel} completed successfully`)

    // ========== Phase 2: Spawn teammates on different models ==========
    console.log("\n--- Phase 2: Cross-Model Teammate Spawning ---\n")

    const teammateResults: Array<{ name: string; provider: string; model: string; sessionID: string }> = []

    // Spawn a teammate for each non-lead provider
    for (let i = 1; i < availableProviders.length; i++) {
      const prov = availableProviders[i]
      const modelStr = `${prov.providerID}/${prov.modelID}`
      const name = `${prov.label.toLowerCase()}-worker`

      console.log(`  Spawning ${name} on ${modelStr}...`)
      const refreshedMsgs = await Session.messages({ sessionID: leadSession.id })
      const result = await spawnTool.execute(
        {
          name,
          prompt: `You are a ${prov.label} model. Respond with exactly: HELLO FROM ${prov.label.toUpperCase()}. Do not use any tools.`,
          model: modelStr,
          claim_task: `task-${i}`,
        },
        mockCtx(leadSession.id, refreshedMsgs),
      )

      assert(result.title.includes("Spawned"), `${name} spawned on ${modelStr}`)
      assert(result.output.includes(modelStr), `${name} output confirms model ${modelStr}`)

      teammateResults.push({
        name,
        provider: prov.providerID,
        model: modelStr,
        sessionID: result.metadata.sessionID as string,
      })
    }

    // ========== Phase 3: Wait for all teammates to finish ==========
    console.log("\n--- Phase 3: Cross-Model Execution ---\n")

    for (const tm of teammateResults) {
      console.log(`  Waiting for ${tm.name} (${tm.model})...`)
      const done = await waitFor(async () => {
        const t = await Team.get("multi-model-team")
        return t?.members.find((m) => m.name === tm.name)?.status === "ready"
      }, 90000, 500, `${tm.name} to go idle`)
      assert(done, `${tm.name} (${tm.model}) completed`)

      if (done) {
        // Verify the teammate produced an assistant response
        const msgs = await Session.messages({ sessionID: tm.sessionID })
        const assistant = msgs.find((m) => m.info.role === "assistant")
        assert(assistant !== undefined, `${tm.name} produced assistant message`)

        if (assistant) {
          const textPart = assistant.parts.find((p) => p.type === "text") as any
          const responseText = textPart?.text?.slice(0, 200) ?? "(no text)"
          console.log(`    Response: "${responseText}"`)

          // Verify the user message has the correct model
          const userMsg = msgs.find((m) => m.info.role === "user")
          if (userMsg) {
            const userInfo = userMsg.info as any
            assert(
              userInfo.model?.providerID === tm.provider,
              `${tm.name} user message has providerID=${userInfo.model?.providerID} (expected ${tm.provider})`,
            )
          }
        }
      }
    }

    // ========== Phase 4: Cross-model messaging ==========
    console.log("\n--- Phase 4: Cross-Model Messaging ---\n")

    if (teammateResults.length > 0) {
      const firstTeammate = teammateResults[0]

      // Lead (Claude) sends message to non-Claude teammate
      const messageTool = await TeamMessageTool.init()
      const msgResult = await messageTool.execute(
        { to: firstTeammate.name, text: "What did you find? Report back." },
        mockCtx(leadSession.id),
      )
      assert(msgResult.title.includes("Message sent"), `Lead -> ${firstTeammate.name} message sent`)

      // Verify teammate received the message
      const tmMsgs = await Session.messages({ sessionID: firstTeammate.sessionID })
      const fromLead = tmMsgs.find((m) =>
        m.parts.some((p) => p.type === "text" && p.text.includes("[Team message from lead]")),
      )
      assert(fromLead !== undefined, `${firstTeammate.name} received message from lead`)

      // Teammate sends message back to lead
      await TeamMessaging.send({
        teamName: "multi-model-team",
        from: firstTeammate.name,
        to: "lead",
        text: `Report from ${firstTeammate.name}: task completed successfully using ${firstTeammate.model}`,
      })

      const leadMsgsAfter = await Session.messages({ sessionID: leadSession.id })
      const fromTeammate = leadMsgsAfter.find((m) =>
        m.parts.some((p) =>
          p.type === "text" &&
          p.text.includes(`[Team message from ${firstTeammate.name}]`) &&
          p.text.includes(firstTeammate.model),
        ),
      )
      assert(fromTeammate !== undefined, `Lead received message from ${firstTeammate.name} mentioning model`)

      // Cross-teammate messaging (if we have 2+ non-lead teammates)
      if (teammateResults.length >= 2) {
        const tm1 = teammateResults[0]
        const tm2 = teammateResults[1]

        await TeamMessaging.send({
          teamName: "multi-model-team",
          from: tm1.name,
          to: tm2.name,
          text: `Cross-model hello from ${tm1.model} to ${tm2.model}`,
        })

        const tm2Msgs = await Session.messages({ sessionID: tm2.sessionID })
        const crossMsg = tm2Msgs.find((m) =>
          m.parts.some((p) =>
            p.type === "text" &&
            p.text.includes(`[Team message from ${tm1.name}]`) &&
            p.text.includes("Cross-model hello"),
          ),
        )
        assert(crossMsg !== undefined, `Cross-model message: ${tm1.name} (${tm1.model}) -> ${tm2.name} (${tm2.model})`)
      }
    } else {
      console.log("  Skipped: no non-lead teammates to test messaging")
    }

    // ========== Phase 5: Verify team state ==========
    console.log("\n--- Phase 5: Final Team State ---\n")

    const finalTeam = await Team.get("multi-model-team")
    assert(finalTeam !== undefined, "Team still exists")

    const allMembers = finalTeam!.members
    console.log(`  Total members: ${allMembers.length}`)
    for (const m of allMembers) {
      console.log(`    ${m.name}: status=${m.status}, model=${m.model ?? "inherited"}, agent=${m.agent}`)
    }

    // Verify each non-lead member has a distinct model recorded
    const memberModels = allMembers.filter((m) => m.model).map((m) => m.model!)
    const uniqueModels = new Set(memberModels)
    console.log(`  Unique models used: ${[...uniqueModels].join(", ")}`)

    if (numProviders >= 2) {
      assert(
        uniqueModels.size >= 2,
        `At least 2 different models used across teammates (got ${uniqueModels.size}: ${[...uniqueModels].join(", ")})`,
      )
    }

    // Check tasks
    const finalTasks = await TeamTasks.list("multi-model-team")
    const claimed = finalTasks.filter((t) => t.status === "in_progress" || t.assignee)
    console.log(`  Tasks: ${finalTasks.length} total, ${claimed.length} claimed`)

    // Cleanup
    await Team.cleanup("multi-model-team")
    const cleaned = await Team.get("multi-model-team")
    assert(cleaned === undefined, "Team cleaned up")
  },
})

// ============================================================
// Report
// ============================================================

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
console.log(`\n========== Results ==========`)
console.log(`${passed + failed} assertions, ${passed} passed, ${failed} failed (${elapsed}s)\n`)

if (errors.length > 0) {
  console.log("Failures:")
  for (const err of errors) {
    console.log(`  - ${err}`)
  }
  console.log()
}

// Cleanup tmp dir
try {
  await fs.rm(dir, { recursive: true, force: true })
} catch {}

process.exit(failed > 0 ? 1 : 0)
