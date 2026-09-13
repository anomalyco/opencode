import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, unlinkSync, writeFileSync } from "fs"
import yargs from "yargs"
import { CandidateStore } from "@opencode-ai/knowledge-engine"
import { LocalEmbedder } from "@opencode-ai/knowledge-engine"
import { LocalVectorDB } from "@opencode-ai/knowledge-engine"
import type { KnowledgeChunk } from "@opencode-ai/knowledge-engine"
import {
  LearnCommand,
  learnAdmitText,
  learnApproveText,
  learnCandidatesText,
  learnProposeText,
  learnRejectText,
  learnRetrieveText,
  learnShowText,
  learnStatusText,
  learnSupersedeText,
  resolveMemoryPaths,
} from "../../src/cli/cmd/learn"

const stagings: string[] = []
const knowledges: string[] = []
const looseFiles: string[] = []
function tempDb(prefix: string): string {
  const path = `/tmp/test_learn_${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e9)}.db`
  if (prefix === "staging") stagings.push(path)
  else knowledges.push(path)
  return path
}

function cleanup(path: string): void {
  for (const file of [path, `${path}-wal`, `${path}-shm`, `${path}-journal`]) {
    try {
      if (existsSync(file)) unlinkSync(file)
    } catch {
      // best-effort cleanup
    }
  }
}

afterEach(() => {
  for (const path of [...stagings.splice(0), ...knowledges.splice(0), ...looseFiles.splice(0)]) cleanup(path)
})

const input = {
  title: "SessionRunner initializes epoch before promotion",
  summary: "Session fixed admission-vs-execution ordering.",
  content: "SessionRunner initializes the context epoch before promoting steers in the runner lifecycle.",
  sourceSession: "ses_learn1",
}

function seed(statuses: ReadonlyArray<"pending" | "approved" | "rejected"> = ["pending"]): {
  staging: string
  knowledge: string
  ids: string[]
} {
  const staging = tempDb("staging")
  const knowledge = tempDb("knowledge")
  const store = new CandidateStore(staging)
  try {
    const ids: string[] = []
    statuses.forEach((status, index) => {
      const created = store.create({ ...input, title: `Rule ${index}`, content: `reviewable content number ${index}` })
      if (status === "approved") store.approve(created.id, "reviewed")
      if (status === "rejected") store.reject(created.id, "not generalizable")
      ids.push(created.id)
    })
    return { staging, knowledge, ids }
  } finally {
    store.close()
  }
}

describe("learn memory commands", () => {
  test("A. candidates lists pending by default and filters by status", async () => {
    const { staging, ids } = seed(["pending", "approved", "rejected"])
    const brief = await learnCandidatesText({ staging })
    expect(brief.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(1)
    expect(brief).toContain(ids[0])
    expect(brief).not.toContain(ids[1])
    const all = await learnCandidatesText({ staging, status: "all" })
    expect(all.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(3)
    const approved = await learnCandidatesText({ staging, status: "approved" })
    expect(approved).toContain(ids[1])
    expect(approved).not.toContain(ids[0])
  })

  test("A2. brief view never prints content or summaries", async () => {
    const { staging } = seed(["pending"])
    const brief = await learnCandidatesText({ staging })
    expect(brief).not.toContain("reviewable content number 0")
  })

  test("B. show is read-only and prints the full record", async () => {
    const { staging, ids } = seed(["pending"])
    const before = new CandidateStore(staging)
    const snapshot = before.get(ids[0])
    before.close()
    const shown = JSON.parse(await learnShowText({ staging, id: ids[0] }))
    expect(shown.candidate.id).toBe(ids[0])
    expect(shown.candidate.provenance.sourceSession).toBe("ses_learn1")
    expect(shown.reviewable).toBe(true)
    const after = new CandidateStore(staging)
    try {
      expect(after.get(ids[0])).toEqual(snapshot)
    } finally {
      after.close()
    }
    await expect(learnShowText({ staging, id: "cand-missing" })).rejects.toThrow(/not found/)
  })

  test("C. approve moves pending to approved only", async () => {
    const { staging, ids } = seed(["pending", "rejected"])
    expect(await learnApproveText({ staging, id: ids[0], note: "verified" })).toBe(`approved ${ids[0]}`)
    await expect(learnApproveText({ staging, id: ids[0] })).rejects.toThrow()
    await expect(learnApproveText({ staging, id: ids[1] })).rejects.toThrow()
  })

  test("D. reject requires a non-empty reason", async () => {
    const { staging, ids } = seed(["pending"])
    expect(await learnRejectText({ staging, id: ids[0], reason: "too narrow" })).toBe(`rejected ${ids[0]}`)
    const { staging: staging2, ids: ids2 } = seed(["pending"])
    await expect(learnRejectText({ staging: staging2, id: ids2[0], reason: "   " })).rejects.toThrow(/reason/)
  })

  test("E. supersede refuses pending, missing, and self replacement", async () => {
    const { staging, ids } = seed(["pending"])
    const store = new CandidateStore(staging)
    const replacement = store.create({ ...input, title: "Replacement", content: "replacement content here" })
    store.close()
    await expect(learnSupersedeText({ staging, oldId: ids[0], newId: replacement.id })).rejects.toThrow()
    await expect(learnSupersedeText({ staging, oldId: ids[0], newId: "cand-missing" })).rejects.toThrow()
    await expect(learnSupersedeText({ staging, oldId: ids[0], newId: ids[0] })).rejects.toThrow()
    await learnApproveText({ staging, id: ids[0], note: "incumbent" })
    await learnApproveText({ staging, id: replacement.id, note: "better" })
    expect(await learnSupersedeText({ staging, oldId: ids[0], newId: replacement.id })).toBe(
      `superseded ${ids[0]} -> ${replacement.id}`
    )
  })

  test("F. admit refuses every non-approved status", async () => {
    const { staging, knowledge, ids } = seed(["pending", "approved", "rejected"])
    for (const id of [ids[0], ids[2]]) {
      await expect(learnAdmitText({ staging, knowledge, id })).rejects.toThrow(/must be approved/)
    }
    const db = new LocalVectorDB(knowledge)
    try {
      expect(db.getStats().totalChunks).toBe(0)
    } finally {
      db.close()
    }
  })

  test("G. admit accepts approved and prints the receipt", async () => {
    const { staging, knowledge, ids } = seed(["approved"])
    const receipt = JSON.parse(await learnAdmitText({ staging, knowledge, id: ids[0] }))
    expect(receipt.receipt.status).toBe("admitted")
    expect(receipt.receipt.candidateId).toBe(ids[0])
  })

  test("H. failed admission claims no success and leaves staging intact", async () => {
    const { staging, ids } = seed(["approved"])
    const store = new CandidateStore(staging)
    const before = store.get(ids[0])
    store.close()
    // Unwritable knowledge location: the write path fails before any claim.
    await expect(
      learnAdmitText({ staging, knowledge: "/nonexistent-dir-4b-test/knowledge.db", id: ids[0] })
    ).rejects.toThrow()
    const after = new CandidateStore(staging)
    try {
      expect(after.get(ids[0])).toEqual(before)
    } finally {
      after.close()
    }
  })

  test("I. repeated admit does not duplicate knowledge", async () => {
    const { staging, knowledge, ids } = seed(["approved"])
    await learnAdmitText({ staging, knowledge, id: ids[0] })
    await learnAdmitText({ staging, knowledge, id: ids[0] })
    const db = new LocalVectorDB(knowledge)
    try {
      expect(db.getStats().totalChunks).toBe(1)
    } finally {
      db.close()
    }
  })

  test("J. identical staging and knowledge paths are refused", () => {
    const staging = tempDb("staging")
    expect(() => resolveMemoryPaths({ staging, knowledge: staging })).toThrow(/must differ/)
  })

  test("K. sequential invocations share files cleanly (no leaked handles)", async () => {
    const { staging, ids } = seed(["pending"])
    await learnApproveText({ staging, id: ids[0], note: "first" })
    await learnShowText({ staging, id: ids[0] })
    await learnCandidatesText({ staging, status: "all" })
    await learnStatusText({ staging, knowledge: tempDb("knowledge") })
    const store = new CandidateStore(staging)
    try {
      expect(store.get(ids[0])?.status).toBe("approved")
    } finally {
      store.close()
    }
  })

  test("L. full cycle: candidates → show → approve → admit → fresh handles retrieve", async () => {
    const staging = tempDb("staging")
    const knowledge = tempDb("knowledge")
    const store = new CandidateStore(staging)
    const id = store.create(input).id
    store.close()

    expect((await learnCandidatesText({ staging })).split("\n")).toHaveLength(1)
    expect(JSON.parse(await learnShowText({ staging, id })).candidate.id).toBe(id)
    await learnApproveText({ staging, id, note: "e2e verified" })
    const receipt = JSON.parse(await learnAdmitText({ staging, knowledge, id }))
    expect(receipt.receipt.status).toBe("admitted")

    // Fresh handles, as a new process would open them.
    const found = await learnRetrieveText({ knowledge, query: "session runner epoch promotion order" })
    expect(found).toContain(id)
    const status = await learnStatusText({ staging, knowledge })
    expect(status).toContain("approved=1")
    expect(status).toContain("indexed_corpus_chunks=1")
    expect(status).toContain("admitted_memory_chunks=1")
  })

  function helpFor(args: ReadonlyArray<string>): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      yargs()
        .command(LearnCommand)
        .strict()
        .exitProcess(false)
        .parse([...args], (error: unknown, _argv: unknown, output: string) => {
          if (error) reject(error)
          else resolve(output ?? "")
        })
    })
  }

  test("routing: subcommand help wins for reserved names, legacy topic preserved", async () => {
    // No handler runs under --help on either path, so this cannot hang or touch databases.
    expect(await helpFor(["learn", "candidates", "--help"])).toContain("--status")
    expect(await helpFor(["learn", "--help"])).toContain("topic")
  })
})

function writeSummary(text: string): string {
  const path = `/tmp/test_learn_summary_${Date.now()}_${Math.floor(Math.random() * 1e9)}.md`
  looseFiles.push(path)
  writeFileSync(path, text)
  return path
}

function seedKnowledge(knowledge: string, sources: ReadonlyArray<string>): void {
  const db = new LocalVectorDB(knowledge)
  try {
    const embedder = new LocalEmbedder()
    sources.forEach((source, index) => {
      const chunk: KnowledgeChunk = {
        id: `chunk-seed-${index}`,
        title: `Seed document ${index}`,
        stage: 1,
        section: "seed",
        content: `seed corpus content number ${index} about the runner architecture`,
        metadata: { source, type: "lesson", tags: [], language: "mixed", difficulty: 1 },
      }
      db.upsertChunk(chunk, embedder.embed(chunk.content))
    })
  } finally {
    db.close()
  }
}

function knowledgeCount(knowledge: string): number {
  const db = new LocalVectorDB(knowledge)
  try {
    return db.getStats().totalChunks
  } finally {
    db.close()
  }
}

const GOOD_BULLET = "SessionRunner initializes the context epoch before promoting steers in the runner lifecycle"
const SECOND_BULLET = "Provider turn allowance resets once per steer batch in the session coordinator"
const SECRET_BULLET = "Deploy with password: s3cr3t-hunter2 value set for staging"
const EPISODIC_BULLET = "User asked to retry the flaky command three times"

describe("learn propose intake", () => {
  test("A. propose from --summary-file stages pending candidates", async () => {
    const staging = tempDb("staging")
    const file = writeSummary(`## Findings\n- ${GOOD_BULLET}\n- ${SECOND_BULLET}`)
    const output = await learnProposeText({ staging, session: "ses_intake1", summaryFile: file })
    expect(output).toContain("extracted=2")
    expect(output).toContain(`staging=${staging}`)
    const store = new CandidateStore(staging)
    try {
      const listed = store.list()
      expect(listed).toHaveLength(2)
      expect(listed.every((candidate) => candidate.status === "pending")).toBe(true)
    } finally {
      store.close()
    }
  })

  test("B. propose from --summary works", async () => {
    const staging = tempDb("staging")
    const output = await learnProposeText({ staging, session: "ses_intake2", summary: GOOD_BULLET })
    expect(output).toContain("extracted=1")
    expect(output).toMatch(/candidate=cand-[0-9a-f]{8}/)
  })

  test("C. both summary sources together are refused", async () => {
    const staging = tempDb("staging")
    const file = writeSummary(GOOD_BULLET)
    await expect(
      learnProposeText({ staging, session: "ses_intake3", summaryFile: file, summary: GOOD_BULLET })
    ).rejects.toThrow(/exactly one/)
  })

  test("D. neither summary source is refused", async () => {
    const staging = tempDb("staging")
    await expect(learnProposeText({ staging, session: "ses_intake4" })).rejects.toThrow(/exactly one/)
  })

  test("D2. missing summary file fails loudly, never silently empty", async () => {
    const staging = tempDb("staging")
    await expect(
      learnProposeText({ staging, session: "ses_intake4b", summaryFile: "/nonexistent-dir-4b-test/summary.md" })
    ).rejects.toThrow()
  })

  test("E. missing session is refused", async () => {
    const staging = tempDb("staging")
    await expect(learnProposeText({ staging, session: "   ", summary: GOOD_BULLET })).rejects.toThrow(/--session/)
  })

  test("F. proposing the same summary twice does not duplicate", async () => {
    const staging = tempDb("staging")
    const file = writeSummary(GOOD_BULLET)
    const first = await learnProposeText({ staging, session: "ses_intake6", summaryFile: file })
    const second = await learnProposeText({ staging, session: "ses_intake6", summaryFile: file })
    expect(second).toContain("extracted=1")
    const store = new CandidateStore(staging)
    try {
      expect(store.list()).toHaveLength(1)
    } finally {
      store.close()
    }
    expect(first).toContain("candidate=")
  })

  test("G. secrets and episodic units never reach staging", async () => {
    const staging = tempDb("staging")
    const output = await learnProposeText({
      staging,
      session: "ses_intake7",
      summary: [GOOD_BULLET, SECRET_BULLET, EPISODIC_BULLET].join("\n- "),
    })
    expect(output).toContain("extracted=1")
    const store = new CandidateStore(staging)
    try {
      const listed = store.list()
      expect(listed).toHaveLength(1)
      expect(listed[0].content).toBe(GOOD_BULLET)
    } finally {
      store.close()
    }
  })

  test("H. propose never writes to knowledge.db", async () => {
    const staging = tempDb("staging")
    const knowledge = tempDb("knowledge")
    seedKnowledge(knowledge, ["guide.md", "spec.md"])
    expect(knowledgeCount(knowledge)).toBe(2)
    await learnProposeText({ staging, session: "ses_intake8", summary: GOOD_BULLET })
    expect(knowledgeCount(knowledge)).toBe(2)
  })

  test("I. propose changes nothing to approved", async () => {
    const staging = tempDb("staging")
    await learnProposeText({ staging, session: "ses_intake9", summary: GOOD_BULLET })
    const store = new CandidateStore(staging)
    try {
      expect(store.list({ status: "approved" })).toHaveLength(0)
      expect(store.list().every((candidate) => candidate.status === "pending")).toBe(true)
    } finally {
      store.close()
    }
  })

  test("J. status separates corpus size from governed admissions", async () => {
    const staging = tempDb("staging")
    const knowledge = tempDb("knowledge")
    seedKnowledge(knowledge, ["guide.md", "spec.md"])
    const status = await learnStatusText({ staging, knowledge })
    expect(status).toContain("indexed_corpus_chunks=2")
    expect(status).not.toContain("admitted=")
  })

  test("K. admitted_memory_chunks is zero before any admission", async () => {
    const staging = tempDb("staging")
    const knowledge = tempDb("knowledge")
    seedKnowledge(knowledge, ["guide.md", "spec.md"])
    await learnProposeText({ staging, session: "ses_intake11", summary: GOOD_BULLET })
    const status = await learnStatusText({ staging, knowledge })
    expect(status).toContain("indexed_corpus_chunks=2")
    expect(status).toContain("admitted_memory_chunks=0")
  })

  test("L2. one admission moves both counters by exactly one", async () => {
    const staging = tempDb("staging")
    const knowledge = tempDb("knowledge")
    seedKnowledge(knowledge, ["guide.md", "spec.md"])
    await learnProposeText({ staging, session: "ses_intake12", summary: GOOD_BULLET })
    const store = new CandidateStore(staging)
    const id = store.list()[0].id
    store.close()
    await learnApproveText({ staging, id, note: "verified" })
    await learnAdmitText({ staging, knowledge, id })
    const status = await learnStatusText({ staging, knowledge })
    expect(status).toContain("indexed_corpus_chunks=3")
    expect(status).toContain("admitted_memory_chunks=1")
  })

  test("M. restart preserves proposed candidates", async () => {
    const staging = tempDb("staging")
    await learnProposeText({ staging, session: "ses_intake13", summary: GOOD_BULLET })
    const reopened = new CandidateStore(staging)
    try {
      const listed = reopened.list()
      expect(listed).toHaveLength(1)
      expect(listed[0].status).toBe("pending")
      expect(listed[0].content).toBe(GOOD_BULLET)
    } finally {
      reopened.close()
    }
  })

  test("N. production cycle: propose → candidates → show → approve → admit → retrieve", async () => {
    const staging = tempDb("staging")
    const knowledge = tempDb("knowledge")
    const proposed = await learnProposeText({ staging, session: "ses_intake14", summary: GOOD_BULLET })
    expect(proposed).toContain("extracted=1")
    const brief = await learnCandidatesText({ staging })
    expect(brief.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(1)
    const store = new CandidateStore(staging)
    const id = store.list()[0].id
    store.close()
    expect(JSON.parse(await learnShowText({ staging, id })).candidate.id).toBe(id)
    await learnApproveText({ staging, id, note: "cycle verified" })
    const receipt = JSON.parse(await learnAdmitText({ staging, knowledge, id }))
    expect(receipt.receipt.status).toBe("admitted")
    // Fresh handles, as a new process would open them.
    const found = await learnRetrieveText({ knowledge, query: "session runner epoch promotion order" })
    expect(found).toContain(id)
    const status = await learnStatusText({ staging, knowledge })
    expect(status).toContain("admitted_memory_chunks=1")
  })
})
