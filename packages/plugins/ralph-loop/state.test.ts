import { describe, expect, test } from "bun:test"
import { decide, hasCompletion, initialState, parseCommand, renderContinuation, renderKickoff } from "./state.js"

describe("parseCommand", () => {
  test("exige task e aceita completion e max-iterations", () => {
    const parsed = parseCommand('build the API --completion-promise "DONE" --max-iterations 7')
    expect(parsed).toEqual({
      prompt: "build the API",
      completion: "DONE",
      maxIterations: 7,
    })
  })

  test("usa 50 iterações por omissão", () => {
    const parsed = parseCommand("fix the tests --completion-promise DONE")
    expect(parsed).toMatchObject({ maxIterations: 50 })
  })

  test("rejeita prompt vazio, iteração inválida e flag desconhecida", () => {
    expect(parseCommand("")).toEqual({
      error: "usage: /ralph-loop <task> [--completion-promise <text>] [--max-iterations <n>]",
    })
    expect(parseCommand("task --max-iterations 0")).toEqual({ error: "--max-iterations must be a positive integer" })
    expect(parseCommand("task --nope")).toEqual({ error: "unknown option: --nope" })
  })
})

describe("decide", () => {
  const base = { prompt: "do it", completion: "DONE", maxIterations: 2 }
  test("continua enquanto não há marker e há orçamento", () => {
    const state = initialState(base)
    const out = decide({ state, assistantText: "not yet" })
    expect(out.kind).toBe("continue")
    if (out.kind === "continue") {
      expect(out.state.iteration).toBe(1)
      expect(out.text).toContain("do it")
    }
  })

  test("conclui quando o assistant contém o marker", () => {
    const state = initialState(base)
    const out = decide({ state, assistantText: "all good <promise>DONE</promise>" })
    expect(out.kind).toBe("done")
    expect(out.state.status).toBe("done")
  })

  test("pausa ao atingir maxIterations", () => {
    const state = { ...initialState(base), iteration: 2 }
    const out = decide({ state, assistantText: "still working" })
    expect(out.kind).toBe("paused")
    if (out.kind === "paused") expect(out.reason).toContain("2")
  })

  test("marker exato no texto do assistant conclui", () => {
    expect(hasCompletion("<promise>DONE</promise>", "DONE")).toBe(true)
    const state = initialState(base)
    const out = decide({ state, assistantText: "the user asked for <promise>DONE</promise>" })
    expect(out.kind).toBe("done")
  })

  test("estado inativo não continua", () => {
    const state = { ...initialState(base), status: "done" as const }
    expect(decide({ state, assistantText: "anything" }).kind).toBe("done")
  })
})

describe("prompts", () => {
  test("kickoff e continuação carregam a task", () => {
    expect(renderKickoff("do it", "DONE")).toContain("do it")
    expect(renderKickoff("do it", "DONE")).toContain("DONE")
    expect(renderContinuation("do it", "DONE", 2, 5)).toContain("do it")
    expect(renderContinuation("do it", "DONE", 2, 5)).toContain("2/5")
  })
})
