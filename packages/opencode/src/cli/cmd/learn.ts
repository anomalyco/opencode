import type { CommandModule } from "yargs"
import {
  CandidateStore,
  LocalRetriever,
  LocalVectorDB,
  RetrievalEngine,
  admit,
  decide,
  extractCandidates,
  pendingReviews,
  resolveCandidatesDbPath,
  resolveKnowledgeDbPath,
  reviewCandidate,
  toReviewView,
  type CandidateStatus,
} from "@opencode-ai/knowledge-engine"
import { resolve as resolvePath } from "path"
import { readFileSync } from "fs"
import { UI, Style } from "../ui"
import readline from "readline"

interface LearnArgs {
  topic?: string
}

async function teachAboutTopic(retriever: RetrievalEngine, topic: string) {
  UI.println(`${Style.TEXT_HIGHLIGHT_BOLD}\n🎓 التعلم عن: ${topic}\n${Style.TEXT_NORMAL}`)

  const [overview, examples, practice] = await Promise.all([
    retriever.search(topic, { topK: 2 }),
    retriever.search(`مثال على ${topic}`, { topK: 2 }),
    retriever.search(`تمرين ${topic}`, { topK: 1, type: "practice" }),
  ])

  UI.println(`${Style.TEXT_SUCCESS_BOLD}📖 ملخص الموضوع:${Style.TEXT_NORMAL}`)
  if (overview.length > 0) {
    overview.forEach((o) => UI.println(`\n${o.content}\n`))
  } else {
    UI.println(`${Style.TEXT_DIM}لا يوجد ملخص مباشر متاح لهذا العنوان.${Style.TEXT_NORMAL}\n`)
  }

  UI.println(`${Style.TEXT_SUCCESS_BOLD}💡 أمثلة عملية:${Style.TEXT_NORMAL}`)
  if (examples.length > 0) {
    examples.forEach((e) => UI.println(`\n${e.content}\n`))
  } else {
    UI.println(`${Style.TEXT_DIM}راجع قسم الدروس والأدلة لمزيد من الأمثلة.${Style.TEXT_NORMAL}\n`)
  }

  if (practice.length > 0) {
    UI.println(`${Style.TEXT_SUCCESS_BOLD}🧪 تمرين تطبيقي:${Style.TEXT_NORMAL}`)
    UI.println(`\n${practice[0].content}\n`)
  }

  UI.println(
    `${Style.TEXT_WARNING}💬 هل تريد معرفة المزيد؟ اسأل سؤالاً جديداً أو شغّل: opencode search "${topic}"\n${Style.TEXT_NORMAL}`
  )
}

async function interactiveLearnMode(retriever: RetrievalEngine) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  UI.println(`${Style.TEXT_SUCCESS_BOLD}📚 المراحل والمواضيع المتاحة:\n${Style.TEXT_NORMAL}`)
  UI.println("  1. البدء السريع (المرحلة 1)")
  UI.println("  2. الاستخدام اليومي وسير العمل (المرحلة 2)")
  UI.println("  3. استخدام Plan و Build Agents (المرحلة 3)")
  UI.println("  4. المشاريع العملية وتطوير التطبيقات (المرحلة 4)")
  UI.println("  5. التخصيص المتقدم والنماذج الصينية (المرحلة 5)\n")

  const answer = await new Promise<string>((resolve) => {
    rl.question(`${Style.TEXT_HIGHLIGHT}اختر رقماً أو اكتب موضوعاً: ${Style.TEXT_NORMAL}`, (ans) => {
      rl.close()
      resolve(ans.trim())
    })
  })

  const topics: Record<string, string> = {
    "1": "البدء السريع مع OpenCode",
    "2": "الاستخدام اليومي وسير العمل",
    "3": "استخدام Plan و Build Agents",
    "4": "مشاريع عملية",
    "5": "customization متقدم ونماذج صينية",
  }

  const selectedTopic = topics[answer] || answer || "البدء السريع مع OpenCode"
  await teachAboutTopic(retriever, selectedTopic)
}

// ---------------------------------------------------------------------------
// Permanent memory commands (Phase 4B review/admission workflow).
//
// Every function below takes explicit database paths, returns printable text,
// and throws on refusal — handlers only print. Staging and knowledge handles
// are opened, used sequentially, and closed in a finally block per invocation.
// Review decisions and admission are separate commands by design: there is no
// approve-and-admit, and admission never changes staging state.
// ---------------------------------------------------------------------------

export interface MemoryDbOptions {
  /** Test-only override. Defaults to the approved staging resolution path. */
  staging?: string
  /** Test-only override. Defaults to the approved knowledge resolution path. */
  knowledge?: string
}

export function resolveMemoryPaths(options: MemoryDbOptions): { staging: string; knowledge: string } {
  const staging = resolvePath(resolveCandidatesDbPath(options.staging))
  const knowledge = resolvePath(resolveKnowledgeDbPath(options.knowledge))
  if (staging === knowledge) {
    throw new Error(
      `Refusing: staging and knowledge database paths must differ (both resolved to ${staging}). ` +
        `Staging is audit storage; knowledge is active retrieval storage.`
    )
  }
  return { staging, knowledge }
}

export type CandidateFilter = CandidateStatus | "all"

const STATUSES: ReadonlyArray<CandidateStatus> = ["pending", "approved", "rejected", "superseded"]

export async function learnProposeText(
  options: MemoryDbOptions & { session: string; summaryFile?: string; summary?: string }
): Promise<string> {
  const session = options.session?.trim() ?? ""
  if (session.length === 0) throw new Error("propose requires --session <session-id>.")
  const hasFile = (options.summaryFile ?? "").length > 0
  const hasInline = (options.summary ?? "").length > 0
  if (hasFile === hasInline) {
    throw new Error('propose requires exactly one of --summary-file <path> or --summary "<text>".')
  }
  // Compaction summaries only. Missing files throw (no false success).
  const summary = hasFile ? readFileSync(options.summaryFile as string, "utf8") : (options.summary as string)
  const { staging } = resolveMemoryPaths({ staging: options.staging })
  const inputs = extractCandidates(summary, session)
  const store = new CandidateStore(staging)
  try {
    // B2 gates already filtered secrets and episodic units. Everything staged
    // stays pending: no approval, no admission, no knowledge.db writes here.
    const ids = inputs.map((candidateInput) => store.create(candidateInput).id)
    return [`extracted=${inputs.length}`, ...ids.map((id) => `candidate=${id}`), `staging=${staging}`].join("\n")
  } finally {
    store.close()
  }
}

export async function learnCandidatesText(options: MemoryDbOptions & { status?: CandidateFilter }): Promise<string> {
  const { staging } = resolveMemoryPaths(options)
  const filter = options.status ?? "pending"
  const store = new CandidateStore(staging)
  try {
    const views =
      filter === "all"
        ? store.list().map(toReviewView)
        : filter === "pending"
          ? pendingReviews(store)
          : store.list({ status: filter }).map(toReviewView)
    // Brief view only: id, status, type, title. No content, no summary —
    // the list must never leak long text or secrets.
    return views
      .map((view) => {
        const flag = view.canApprove ? "" : " ⚠ needs-attention"
        return `- ${view.candidate.id} [${view.candidate.status}/${view.candidate.type}] ${view.candidate.title}${flag}`
      })
      .join("\n")
  } finally {
    store.close()
  }
}

export async function learnShowText(options: MemoryDbOptions & { id: string }): Promise<string> {
  const { staging } = resolveMemoryPaths(options)
  const store = new CandidateStore(staging)
  try {
    // Read-only: reviewCandidate never mutates state.
    return JSON.stringify(reviewCandidate(store, options.id), null, 2)
  } finally {
    store.close()
  }
}

export async function learnApproveText(
  options: MemoryDbOptions & { id: string; note?: string }
): Promise<string> {
  const { staging } = resolveMemoryPaths(options)
  const store = new CandidateStore(staging)
  try {
    // decide() enforces pending-only plus B0 validity; reasons surface on refusal.
    const updated = decide(store, options.id, { action: "approve", note: options.note ?? "" })
    return `approved ${updated.id}`
  } finally {
    store.close()
  }
}

export async function learnRejectText(
  options: MemoryDbOptions & { id: string; reason: string }
): Promise<string> {
  if (options.reason.trim().length === 0) throw new Error("Rejecting a candidate requires a non-empty --reason.")
  const { staging } = resolveMemoryPaths(options)
  const store = new CandidateStore(staging)
  try {
    const updated = decide(store, options.id, { action: "reject", reason: options.reason })
    return `rejected ${updated.id}`
  } finally {
    store.close()
  }
}

export async function learnSupersedeText(
  options: MemoryDbOptions & { oldId: string; newId: string }
): Promise<string> {
  const { staging } = resolveMemoryPaths(options)
  const store = new CandidateStore(staging)
  try {
    // decide() enforces: both approved, distinct ids. No implicit admission.
    const updated = decide(store, options.oldId, { action: "supersede", byId: options.newId })
    return `superseded ${updated.id} -> ${updated.supersededBy}`
  } finally {
    store.close()
  }
}

export async function learnAdmitText(options: MemoryDbOptions & { id: string }): Promise<string> {
  const { staging, knowledge } = resolveMemoryPaths(options)
  const store = new CandidateStore(staging)
  const db = new LocalVectorDB(knowledge)
  try {
    // admit() enforces approved-only, verifies persistence and retrieval,
    // and compensates post-write failures. It never mutates staging.
    const result = await admit({ store, knowledge: db }, options.id)
    return JSON.stringify(result, null, 2)
  } finally {
    store.close()
    db.close()
  }
}

export async function learnRetrieveText(
  options: MemoryDbOptions & { query: string; topK?: number }
): Promise<string> {
  const { knowledge } = resolveMemoryPaths(options)
  const db = new LocalVectorDB(knowledge)
  try {
    const results = await new LocalRetriever(db).retrieveRelevant(options.query, options.topK ?? 5)
    if (results.length === 0) return "results=0"
    return [
      ...results.flatMap((result, index) => {
        const snippet =
          result.content.length > 300 ? result.content.substring(0, 300) + "..." : result.content
        return [`#${index + 1} [${result.similarity}] ${result.title} (${result.id})`, `   ${snippet}`]
      }),
      `results=${results.length}`,
    ].join("\n")
  } finally {
    db.close()
  }
}

export async function learnStatusText(options: MemoryDbOptions): Promise<string> {
  const { staging, knowledge } = resolveMemoryPaths(options)
  const store = new CandidateStore(staging)
  try {
    const counts: Record<CandidateStatus, number> = { pending: 0, approved: 0, rejected: 0, superseded: 0 }
    let extracted = 0
    for (const candidate of store.list()) {
      extracted += 1
      counts[candidate.status] += 1
    }
    const db = new LocalVectorDB(knowledge)
    try {
      // indexed_corpus_chunks counts every indexed row (legacy corpus included).
      // admitted_memory_chunks counts only governed admissions, recognized by
      // the candidate admission provenance B4 stamps on every admitted chunk.
      // The old `admitted` key (total rows) was misleading and is removed.
      const admittedMemory = db.countBySourcePrefix("candidate:")
      const indexed = db.getStats().totalChunks
      return [
        `extracted=${extracted}`,
        `pending=${counts.pending}`,
        `approved=${counts.approved}`,
        `rejected=${counts.rejected}`,
        `superseded=${counts.superseded}`,
        `indexed_corpus_chunks=${indexed}`,
        `admitted_memory_chunks=${admittedMemory}`,
        `admission_failures=untracked`,
        `admitted_retrieved_later=untracked`,
      ].join("\n")
    } finally {
      db.close()
    }
  } finally {
    store.close()
  }
}

const STAGING_OPTION = {
  describe: "staging database path (test override only; defaults to the approved staging path)",
  type: "string",
} as const

const KNOWLEDGE_OPTION = {
  describe: "knowledge database path (test override only; defaults to the approved knowledge path)",
  type: "string",
} as const

export const LearnProposeCommand = {
  command: "propose",
  describe: "propose candidates from a compaction summary into staging (all stay pending)",
  builder: (yargs) =>
    yargs
      .option("staging", STAGING_OPTION)
      .option("session", { describe: "source session id (required)", type: "string", demandOption: true })
      .option("summary-file", { describe: "path to a compaction summary file", type: "string" })
      .option("summary", { describe: "compaction summary text", type: "string" }),
  handler: async (args) => {
    UI.println(
      await learnProposeText({
        staging: args.staging,
        session: args.session as string,
        summaryFile: args["summary-file"] as string | undefined,
        summary: args.summary as string | undefined,
      })
    )
  },
} satisfies CommandModule<object, { staging?: string; session: string; "summary-file"?: string; summary?: string }>

export const LearnCandidatesCommand = {
  command: "candidates",
  describe: "list staged knowledge candidates (pending by default)",
  builder: (yargs) =>
    yargs
      .option("staging", STAGING_OPTION)
      .option("status", {
        describe: "filter by review status",
        type: "string",
        choices: ["pending", "approved", "rejected", "superseded", "all"],
        default: "pending",
      }),
  handler: async (args) => {
    UI.println(
      await learnCandidatesText({
        staging: args.staging,
        status: args.status as CandidateFilter | undefined,
      })
    )
  },
} satisfies CommandModule<object, { staging?: string; status?: string }>

export const LearnShowCommand = {
  command: "show <id>",
  describe: "show one staged candidate in full (read-only)",
  builder: (yargs) =>
    yargs
      .option("staging", STAGING_OPTION)
      .positional("id", { describe: "candidate id", type: "string", demandOption: true }),
  handler: async (args) => {
    UI.println(await learnShowText({ staging: args.staging, id: args.id as string }))
  },
} satisfies CommandModule<object, { staging?: string; id: string }>

export const LearnApproveCommand = {
  command: "approve <id>",
  describe: "approve a pending candidate (review decision only; does not admit)",
  builder: (yargs) =>
    yargs
      .option("staging", STAGING_OPTION)
      .positional("id", { describe: "candidate id", type: "string", demandOption: true })
      .option("note", { describe: "reviewer note", type: "string", default: "" }),
  handler: async (args) => {
    UI.println(await learnApproveText({ staging: args.staging, id: args.id as string, note: args.note }))
  },
} satisfies CommandModule<object, { staging?: string; id: string; note?: string }>

export const LearnRejectCommand = {
  command: "reject <id>",
  describe: "reject a pending candidate with a required reason",
  builder: (yargs) =>
    yargs
      .option("staging", STAGING_OPTION)
      .positional("id", { describe: "candidate id", type: "string", demandOption: true })
      .option("reason", { describe: "rejection reason (required)", type: "string", demandOption: true }),
  handler: async (args) => {
    UI.println(await learnRejectText({ staging: args.staging, id: args.id as string, reason: args.reason as string }))
  },
} satisfies CommandModule<object, { staging?: string; id: string; reason: string }>

export const LearnSupersedeCommand = {
  command: "supersede <old-id> <new-id>",
  describe: "mark an approved candidate superseded by another approved candidate",
  builder: (yargs) =>
    yargs
      .option("staging", STAGING_OPTION)
      .positional("old-id", { describe: "superseded candidate id", type: "string", demandOption: true })
      .positional("new-id", { describe: "replacement candidate id", type: "string", demandOption: true }),
  handler: async (args) => {
    UI.println(
      await learnSupersedeText({
        staging: args.staging,
        oldId: args["old-id"] as string,
        newId: args["new-id"] as string,
      })
    )
  },
} satisfies CommandModule<object, { staging?: string; "old-id": string; "new-id": string }>

export const LearnAdmitCommand = {
  command: "admit <id>",
  describe: "admit an approved candidate into knowledge (verifies persistence and retrieval)",
  builder: (yargs) =>
    yargs
      .option("staging", STAGING_OPTION)
      .option("knowledge", KNOWLEDGE_OPTION)
      .positional("id", { describe: "candidate id", type: "string", demandOption: true }),
  handler: async (args) => {
    UI.println(await learnAdmitText({ staging: args.staging, knowledge: args.knowledge, id: args.id as string }))
  },
} satisfies CommandModule<object, { staging?: string; knowledge?: string; id: string }>

export const LearnRetrieveCommand = {
  command: "retrieve",
  describe: "retrieve approved knowledge by query",
  builder: (yargs) =>
    yargs
      .option("staging", STAGING_OPTION)
      .option("knowledge", KNOWLEDGE_OPTION)
      .option("query", { describe: "natural-language query", type: "string", demandOption: true })
      .option("top-k", { describe: "max results", type: "number", default: 5 }),
  handler: async (args) => {
    UI.println(
      await learnRetrieveText({
        staging: args.staging,
        knowledge: args.knowledge,
        query: args.query as string,
        topK: args["top-k"] as number | undefined,
      })
    )
  },
} satisfies CommandModule<object, { staging?: string; knowledge?: string; query: string; "top-k"?: number }>

export const LearnStatusCommand = {
  command: "status",
  describe: "operational counters for staging and knowledge",
  builder: (yargs) => yargs.option("staging", STAGING_OPTION).option("knowledge", KNOWLEDGE_OPTION),
  handler: async (args) => {
    UI.println(await learnStatusText({ staging: args.staging, knowledge: args.knowledge }))
  },
} satisfies CommandModule<object, { staging?: string; knowledge?: string }>

export const LearnCommand = {
  command: "learn [topic]",
  describe: "📚 interactive knowledge learning mode",
  builder: (yargs) =>
    yargs
      .positional("topic", {
        describe: "topic or concept to learn about (optional)",
        type: "string",
      })
      .command(LearnProposeCommand)
      .command(LearnCandidatesCommand)
      .command(LearnShowCommand)
      .command(LearnApproveCommand)
      .command(LearnRejectCommand)
      .command(LearnSupersedeCommand)
      .command(LearnAdmitCommand)
      .command(LearnRetrieveCommand)
      .command(LearnStatusCommand),
  handler: async (args) => {
    const retriever = new RetrievalEngine()

    UI.println(
      `${Style.TEXT_HIGHLIGHT_BOLD}╔════════════════════════════════════════════╗\n║   📚 وضع التعلم التفاعلي - OpenCode       ║\n╚════════════════════════════════════════════╝${Style.TEXT_NORMAL}`
    )

    if (args.topic) {
      await teachAboutTopic(retriever, args.topic)
    } else {
      await interactiveLearnMode(retriever)
    }
  },
} satisfies CommandModule<object, LearnArgs>
