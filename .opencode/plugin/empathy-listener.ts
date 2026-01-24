import { Plugin, tool } from "@opencode-ai/plugin"
import path from "path"
import os from "os"

/**
 * Empathy Listener Plugin
 *
 * A long-lived conversational companion that:
 * - Listens empathetically and understands situations thoroughly
 * - Only provides solutions when explicitly asked with "HELP ME"
 * - Maintains persistent conversation history across years
 * - Uses smart context retrieval with decay to avoid context pollution
 */

// Storage location for empathy listener data
const STORAGE_DIR = path.join(os.homedir(), ".opencode-empathy-listener")

// Types for conversation storage
interface ConversationEntry {
  id: string
  timestamp: number
  role: "user" | "listener"
  content: string
  // Emotional tags detected
  emotions?: string[]
  // Key topics discussed
  topics?: string[]
  // Importance score (1-10) - higher = more important to remember
  importance: number
  // Whether this was a "HELP ME" request
  helpRequest?: boolean
  // Summary of the entry (for long entries)
  summary?: string
}

interface ThreadMeta {
  id: string
  title: string
  createdAt: number
  lastActiveAt: number
  // Running summary of the entire thread
  runningSummary: string
  // Key themes that have emerged
  themes: string[]
  // Total entries count
  entryCount: number
  // Last retrieved context window
  lastContextWindow?: string
}

// Decay constants
const DECAY_HALF_LIFE_DAYS = 30 // Importance decays by half every 30 days
const MAX_CONTEXT_ENTRIES = 50 // Maximum entries to include in context
const RECENT_ENTRIES_COUNT = 10 // Always include last N entries regardless of decay

// Helper functions
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

function calculateDecayedImportance(entry: ConversationEntry, now: number): number {
  const ageInDays = (now - entry.timestamp) / (1000 * 60 * 60 * 24)
  const decayFactor = Math.pow(0.5, ageInDays / DECAY_HALF_LIFE_DAYS)
  return entry.importance * decayFactor
}

async function ensureStorageDir(): Promise<void> {
  await Bun.write(path.join(STORAGE_DIR, ".gitkeep"), "")
}

async function getThreadMeta(threadId: string): Promise<ThreadMeta | null> {
  const metaPath = path.join(STORAGE_DIR, "threads", threadId, "meta.json")
  try {
    return await Bun.file(metaPath).json()
  } catch {
    return null
  }
}

async function saveThreadMeta(meta: ThreadMeta): Promise<void> {
  const metaPath = path.join(STORAGE_DIR, "threads", meta.id, "meta.json")
  await Bun.write(metaPath, JSON.stringify(meta, null, 2))
}

async function getEntries(threadId: string): Promise<ConversationEntry[]> {
  const entriesPath = path.join(STORAGE_DIR, "threads", threadId, "entries.json")
  try {
    return await Bun.file(entriesPath).json()
  } catch {
    return []
  }
}

async function saveEntries(threadId: string, entries: ConversationEntry[]): Promise<void> {
  const entriesPath = path.join(STORAGE_DIR, "threads", threadId, "entries.json")
  await Bun.write(entriesPath, JSON.stringify(entries, null, 2))
}

async function listThreads(): Promise<ThreadMeta[]> {
  const threadsDir = path.join(STORAGE_DIR, "threads")
  const threads: ThreadMeta[] = []

  try {
    const glob = new Bun.Glob("*/meta.json")
    for await (const file of glob.scan({ cwd: threadsDir, absolute: true })) {
      try {
        const meta = await Bun.file(file).json()
        threads.push(meta)
      } catch {
        // Skip invalid files
      }
    }
  } catch {
    // No threads directory yet
  }

  return threads.sort((a, b) => b.lastActiveAt - a.lastActiveAt)
}

async function getActiveThreadId(): Promise<string | null> {
  const activePath = path.join(STORAGE_DIR, "active-thread.json")
  try {
    const data = await Bun.file(activePath).json()
    return data.threadId
  } catch {
    return null
  }
}

async function setActiveThread(threadId: string): Promise<void> {
  const activePath = path.join(STORAGE_DIR, "active-thread.json")
  await Bun.write(activePath, JSON.stringify({ threadId }))
}

// Smart context retrieval with decay
async function retrieveContext(
  threadId: string,
  query?: string,
): Promise<{
  recentEntries: ConversationEntry[]
  relevantEntries: ConversationEntry[]
  summary: string
  themes: string[]
}> {
  const entries = await getEntries(threadId)
  const meta = await getThreadMeta(threadId)
  const now = Date.now()

  // Always get the most recent entries
  const recentEntries = entries.slice(-RECENT_ENTRIES_COUNT)

  // Get older entries sorted by decayed importance
  const olderEntries = entries.slice(0, -RECENT_ENTRIES_COUNT)
  const scoredEntries = olderEntries
    .map((entry) => ({
      entry,
      score: calculateDecayedImportance(entry, now),
    }))
    .sort((a, b) => b.score - a.score)

  // Take top entries by decayed importance
  const relevantCount = MAX_CONTEXT_ENTRIES - recentEntries.length
  const relevantEntries = scoredEntries.slice(0, relevantCount).map((x) => x.entry)

  return {
    recentEntries,
    relevantEntries,
    summary: meta?.runningSummary || "No previous context.",
    themes: meta?.themes || [],
  }
}

// Format context for the agent
function formatContextForAgent(context: Awaited<ReturnType<typeof retrieveContext>>): string {
  const parts: string[] = []

  if (context.summary) {
    parts.push("## Conversation Summary\n" + context.summary)
  }

  if (context.themes.length > 0) {
    parts.push("## Key Themes\n" + context.themes.map((t) => `- ${t}`).join("\n"))
  }

  if (context.relevantEntries.length > 0) {
    parts.push(
      "## Important Past Moments (by relevance)\n" +
        context.relevantEntries
          .map((e) => {
            const date = new Date(e.timestamp).toLocaleDateString()
            const summary = e.summary || e.content.slice(0, 200)
            return `[${date}] ${e.role}: ${summary}${e.emotions?.length ? ` (${e.emotions.join(", ")})` : ""}`
          })
          .join("\n\n"),
    )
  }

  if (context.recentEntries.length > 0) {
    parts.push(
      "## Recent Conversation\n" +
        context.recentEntries
          .map((e) => {
            const date = new Date(e.timestamp).toLocaleDateString()
            return `[${date}] ${e.role}: ${e.content}`
          })
          .join("\n\n"),
    )
  }

  return parts.join("\n\n---\n\n")
}

export const EmpathyListenerPlugin: Plugin = async (ctx) => {
  await ensureStorageDir()

  return {
    tool: {
      /**
       * Store a conversation entry
       */
      empathy_store: tool({
        description: `Store a conversation entry in the empathy listener thread. Use this AFTER every exchange to persist the conversation.
Call this tool to save:
- The user's message (role: "user")
- Your response (role: "listener")

The importance score (1-10) should reflect:
- 10: Major life events, trauma, breakthroughs, "HELP ME" requests
- 7-9: Significant emotional moments, key decisions
- 4-6: Regular emotional check-ins, ongoing situations
- 1-3: Casual updates, small talk`,
        args: {
          content: tool.schema.string().describe("The message content to store"),
          role: tool.schema.enum(["user", "listener"]).describe("Who said this"),
          emotions: tool.schema
            .array(tool.schema.string())
            .optional()
            .describe("Detected emotions (e.g., 'frustrated', 'hopeful', 'anxious')"),
          topics: tool.schema.array(tool.schema.string()).optional().describe("Key topics discussed"),
          importance: tool.schema.number().min(1).max(10).describe("Importance score 1-10 for memory prioritization"),
          helpRequest: tool.schema.boolean().optional().describe("Set true if this is a HELP ME request"),
          summary: tool.schema.string().optional().describe("Brief summary for long entries"),
        },
        async execute(args) {
          const threadId = await getActiveThreadId()
          if (!threadId) {
            return "Error: No active empathy listener thread. Use empathy_start_thread first."
          }

          const entry: ConversationEntry = {
            id: generateId(),
            timestamp: Date.now(),
            role: args.role,
            content: args.content,
            emotions: args.emotions,
            topics: args.topics,
            importance: args.importance,
            helpRequest: args.helpRequest,
            summary: args.summary,
          }

          const entries = await getEntries(threadId)
          entries.push(entry)
          await saveEntries(threadId, entries)

          // Update thread meta
          const meta = await getThreadMeta(threadId)
          if (meta) {
            meta.lastActiveAt = Date.now()
            meta.entryCount = entries.length
            if (args.topics) {
              const allTopics = [...meta.themes, ...args.topics]
              meta.themes = [...new Set(allTopics)].slice(-20) // Keep last 20 unique themes
            }
            await saveThreadMeta(meta)
          }

          return `Entry stored (id: ${entry.id}, importance: ${args.importance})`
        },
      }),

      /**
       * Retrieve conversation context with smart decay
       */
      empathy_retrieve: tool({
        description: `Retrieve conversation history from the empathy listener thread with smart decay.
Use this at the START of each interaction to get relevant context.
Returns:
- Recent entries (always included)
- Important past entries (weighted by recency and importance)
- Running summary of the conversation
- Key themes that have emerged`,
        args: {
          query: tool.schema.string().optional().describe("Optional: specific topic to search for"),
        },
        async execute(args) {
          const threadId = await getActiveThreadId()
          if (!threadId) {
            return "No active empathy listener thread. Use empathy_start_thread first."
          }

          const context = await retrieveContext(threadId, args.query)
          return formatContextForAgent(context)
        },
      }),

      /**
       * Update the running summary
       */
      empathy_update_summary: tool({
        description: `Update the running summary of the conversation thread.
Call this periodically (every 5-10 exchanges) to maintain an accurate high-level summary.
The summary should capture:
- The person's current life situation
- Ongoing challenges and goals
- Emotional patterns and growth
- Key relationships and dynamics`,
        args: {
          summary: tool.schema.string().describe("The updated running summary"),
          themes: tool.schema.array(tool.schema.string()).optional().describe("Updated list of key themes"),
        },
        async execute(args) {
          const threadId = await getActiveThreadId()
          if (!threadId) {
            return "Error: No active empathy listener thread."
          }

          const meta = await getThreadMeta(threadId)
          if (!meta) {
            return "Error: Thread metadata not found."
          }

          meta.runningSummary = args.summary
          if (args.themes) {
            meta.themes = args.themes
          }
          await saveThreadMeta(meta)

          return "Summary updated successfully."
        },
      }),

      /**
       * Start or resume a thread
       */
      empathy_start_thread: tool({
        description: `Start a new empathy listener thread or resume an existing one.
A thread represents a long-running conversation that can span months or years.`,
        args: {
          threadId: tool.schema.string().optional().describe("Existing thread ID to resume (leave empty for new)"),
          title: tool.schema.string().optional().describe("Title for new thread (e.g., 'Personal Growth Journey')"),
        },
        async execute(args) {
          if (args.threadId) {
            const meta = await getThreadMeta(args.threadId)
            if (!meta) {
              return `Error: Thread ${args.threadId} not found.`
            }
            await setActiveThread(args.threadId)
            return `Resumed thread: "${meta.title}" (${meta.entryCount} entries, last active: ${new Date(meta.lastActiveAt).toLocaleDateString()})`
          }

          // Create new thread
          const threadId = generateId()
          const meta: ThreadMeta = {
            id: threadId,
            title: args.title || "Empathy Listener Session",
            createdAt: Date.now(),
            lastActiveAt: Date.now(),
            runningSummary: "",
            themes: [],
            entryCount: 0,
          }

          await saveThreadMeta(meta)
          await setActiveThread(threadId)

          return `Created new thread: "${meta.title}" (ID: ${threadId})`
        },
      }),

      /**
       * List all threads
       */
      empathy_list_threads: tool({
        description: "List all empathy listener conversation threads.",
        args: {},
        async execute() {
          const threads = await listThreads()
          if (threads.length === 0) {
            return "No threads found. Use empathy_start_thread to begin."
          }

          const activeId = await getActiveThreadId()

          return threads
            .map((t) => {
              const active = t.id === activeId ? " [ACTIVE]" : ""
              const date = new Date(t.lastActiveAt).toLocaleDateString()
              return `- ${t.title}${active}\n  ID: ${t.id}\n  Entries: ${t.entryCount}, Last active: ${date}\n  Themes: ${t.themes.slice(0, 5).join(", ") || "none yet"}`
            })
            .join("\n\n")
        },
      }),

      /**
       * Ask for clarification about past context
       */
      empathy_clarify: tool({
        description: `Use this when you need to ask the user for clarification about past context.
The decay algorithm may have forgotten details, so it's okay to ask the user to remind you.
This stores a "clarification request" in the thread for reference.`,
        args: {
          topic: tool.schema.string().describe("The topic you need clarification on"),
          question: tool.schema.string().describe("The clarification question to ask"),
        },
        async execute(args) {
          const threadId = await getActiveThreadId()
          if (!threadId) {
            return "Error: No active thread."
          }

          // Store the clarification request
          const entry: ConversationEntry = {
            id: generateId(),
            timestamp: Date.now(),
            role: "listener",
            content: `[Clarification Request] Topic: ${args.topic} - Question: ${args.question}`,
            importance: 3,
            topics: [args.topic],
          }

          const entries = await getEntries(threadId)
          entries.push(entry)
          await saveEntries(threadId, entries)

          return `Stored clarification request. Ask the user: "${args.question}"`
        },
      }),

      /**
       * Analyze if user is asking for help
       */
      empathy_check_help_request: tool({
        description: `Check if the user's message contains an explicit "HELP ME" request.
Only returns true if the user explicitly uses the phrase "HELP ME" (case insensitive).
This triggers solution-mode instead of listening-mode.`,
        args: {
          message: tool.schema.string().describe("The user's message to check"),
        },
        async execute(args) {
          const isHelpRequest = /\bHELP\s+ME\b/i.test(args.message)
          return JSON.stringify({
            isHelpRequest,
            mode: isHelpRequest ? "solution" : "listening",
          })
        },
      }),
    },

    command: {
      listen: {
        description: "Start an empathetic listening session",
        template: `You are now in empathetic listening mode. 

First, use the empathy_list_threads tool to check for existing threads.
Then use empathy_start_thread to either resume an existing thread or create a new one.
After that, use empathy_retrieve to get context from previous conversations.

Remember:
- Listen deeply and empathize
- Only provide solutions when the user explicitly says "HELP ME"
- Store each exchange using empathy_store
- Update the summary periodically

$ARGUMENTS`,
        agent: "empathy",
      },
    },
  }
}

export default EmpathyListenerPlugin
