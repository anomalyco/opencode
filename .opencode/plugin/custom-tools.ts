import { type Plugin, tool } from "@opencode-ai/plugin"
import { readFile, writeFile, mkdir } from "fs/promises"
import { join } from "path"
import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

const MEMORY_FILE = join(__dirname, "memories.json")

type Memory = {
  id: string
  content: string
  tags: string[]
  timestamp: string
}

async function loadMemories(): Promise<Memory[]> {
  const file = Bun.file(MEMORY_FILE)
  if (!(await file.exists())) {
    return []
  }
  const text = await file.text()
  return JSON.parse(text)
}

async function saveMemories(memories: Memory[]): Promise<void> {
  await writeFile(MEMORY_FILE, JSON.stringify(memories, null, 2))
}

export const CustomToolsPlugin: Plugin = async (ctx) => {
  return {
    tool: {
      add_memory: tool({
        description: "Add a new memory with optional tags",
        args: {
          content: tool.schema.string(),
          tags: tool.schema.array(tool.schema.string()).optional(),
        },
        async execute(args) {
          const memories = await loadMemories()
          const memory: Memory = {
            id: Date.now().toString(),
            content: args.content,
            tags: args.tags || [],
            timestamp: new Date().toISOString(),
          }
          memories.push(memory)
          await saveMemories(memories)
          return `Memory added with ID: ${memory.id}`
        },
      }),

      remove_memory: tool({
        description: "Remove a memory by ID",
        args: {
          id: tool.schema.string(),
        },
        async execute(args) {
          const memories = await loadMemories()
          const filtered = memories.filter(m => m.id !== args.id)
          if (filtered.length === memories.length) {
            return `No memory found with ID: ${args.id}`
          }
          await saveMemories(filtered)
          return `Memory ${args.id} removed`
        },
      }),

      list_memory: tool({
        description: "List all memories or filter by tag",
        args: {
          tag: tool.schema.string().optional(),
        },
        async execute(args) {
          const memories = await loadMemories()
          const filtered = args.tag 
            ? memories.filter(m => m.tags.includes(args.tag))
            : memories
          
          if (filtered.length === 0) {
            return "No memories found"
          }

          return filtered.map(m => 
            `ID: ${m.id}\nTime: ${m.timestamp}\nTags: ${m.tags.join(", ")}\nContent: ${m.content}`
          ).join("\n\n---\n\n")
        },
      }),

      find_memory: tool({
        description: "Search memories by content (case-insensitive)",
        args: {
          query: tool.schema.string(),
        },
        async execute(args) {
          const memories = await loadMemories()
          const query = args.query.toLowerCase()
          const matches = memories.filter(m => 
            m.content.toLowerCase().includes(query) ||
            m.tags.some(t => t.toLowerCase().includes(query))
          )

          if (matches.length === 0) {
            return `No memories found matching: ${args.query}`
          }

          return matches.map(m => 
            `ID: ${m.id}\nTime: ${m.timestamp}\nTags: ${m.tags.join(", ")}\nContent: ${m.content}`
          ).join("\n\n---\n\n")
        },
      }),

      ask_codex: tool({
        description: "Ask Codex CLI to check an issue and comment on it in headless mode. Provide the issue number and a prompt describing what to check.",
        args: {
          issue_number: tool.schema.string(),
          prompt: tool.schema.string(),
        },
        async execute(args) {
          const command = `codex --headless --issue ${args.issue_number} --prompt "${args.prompt.replace(/"/g, '\\"')}"`
          
          try {
            const { stdout, stderr } = await execAsync(command)
            
            if (stderr) {
              return `Codex executed with warnings:\n${stderr}\n\nOutput:\n${stdout}`
            }
            
            return `Codex successfully executed:\n${stdout}`
          } catch (error) {
            return `Error executing Codex: ${error instanceof Error ? error.message : String(error)}`
          }
        },
      }),
    },
  }
}
