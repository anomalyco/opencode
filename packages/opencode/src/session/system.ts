import { Instance } from "../project/instance"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_GPT from "./prompt/gpt.txt"

import PROMPT_CODEX from "./prompt/codex.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Skill } from "@/skill"

export namespace SystemPrompt {
  export function provider(model: Provider.Model) {
    if (model.api.id.includes("gpt-4") || model.api.id.includes("o1") || model.api.id.includes("o3"))
      return [PROMPT_BEAST]
    if (model.api.id.includes("gpt")) {
      if (model.api.id.includes("codex")) {
        return [PROMPT_CODEX]
      }
      return [PROMPT_GPT]
    }
    if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
    if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
    if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]
    return [PROMPT_DEFAULT]
  }

  export async function environment(model: Provider.Model) {
    const project = Instance.project
    return [
      [
        `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${Instance.directory}`,
        `  Workspace root folder: ${Instance.worktree}`,
        `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `  Today's date: ${new Date().toDateString()}`,
        `</env>`,
        `<critical-rule>`,
        `For "repeat/iterate/loop/keep going/until done/while" tasks, you are the loop ARCHITECT, not the worker.`,
        `WHY: a bash while-loop is deterministic (never loses count), and each \`oc check\` iteration gets fresh context (no token accumulation).`,
        `YOU MUST NOT start working on these items yourself, read code, or set up todos.`,
        `Set up a while loop that delegates the ENTIRE job to \`oc check\`. Each iteration is a complete attempt at the whole task — not one step of it.`,
        `Pattern: while oc check "DO THE ENTIRE JOB: [user's full criteria here]"; do oc status "round done"; done`,
        `oc is pre-installed inside the bash tool. Do not check if it exists.`,
        ``,
        `IF your task was delegated to you (via oc check/prompt): you ARE the worker. Do the work directly with tools. Do NOT set up another Ralph Loop — the caller already handles iteration.`,
        ``,
        `For tasks that process 3+ files with the same operation (summarize each, analyze each, convert each), ALWAYS use a FABRIC oc script. Test the pipeline on ONE file first. ALWAYS. Then parallelize. Do NOT process files one by one with individual tool calls.`,
        `</critical-rule>`,
      ].join("\n"),
      [
        `<oc-scripting>`,
        `The \`oc\` command calls back into the running OpenCode instance — deterministic control flow + AI judgment at decision points.`,
        `Why oc scripts beat consecutive tool calls: deterministic loops (never lose count), token efficiency`,
        `(each oc prompt gets fresh context), speed (1 bash call vs N round-trips), composability (full Unix toolkit).`,
        ``,
        `<oc-patterns>`,
        `Three core patterns:`,
        ``,
        `1. RALPH LOOP — delegate entire task, re-verify until clean`,
        `   Shape: while oc check "DO THE ENTIRE JOB: [criteria]"; do oc status "round done"; done`,
        `   Each oc check spawns a fresh AI session that handles the WHOLE task — find ALL issues, fix ALL of them, commit.`,
        `   The while loop only exists to re-verify and catch anything missed or newly introduced. Exit 0=found work, 1=clean.`,
        `   For deterministic exit conditions (tests pass): while true; do cmd && break; cmd | oc prompt "fix"; done`,
        ``,
        `2. DETERMINISTIC BATCH — same oc tool operation across many files, NO AI needed`,
        `   Shape: oc tool glob/grep | while IFS= read -r f; do oc tool edit/read "$f" ...; done`,
        `   When: rename, find-replace, count lines, format files, delete matches`,
        ``,
        `3. FABRIC — per-item AI pipelines, parallelized`,
        `   Each item flows through the COMPLETE pipeline: read | process | prompt.`,
        `   NOT: read ALL items first, then summarize ALL — that loses per-item context.`,
        `   Correct:  oc tool read "file.pdf" | oc prompt "summarize"  ← per item, run many in parallel`,
        `   Wrong:    read all files into one blob, then prompt once`,
        `   Reduce:   pipe parallel outputs into a final \`oc prompt -s "Specialist" "synthesize"\``,
        `   Pipeline: oc tool grep "TODO" src/ | oc prompt "Categorize" | oc tool write report.md`,
        ``,
        `These are composable — combine freely.`,
        `</oc-patterns>`,
        ``,
        `<oc-commands>`,
        `Deterministic (reliable, no LLM):`,
        `  oc tool read <path>                 — Read file → stdout`,
        `  oc tool write <path>                — Write stdin → file`,
        `  oc tool edit <path> --old x --new y — Edit file`,
        `  oc tool grep "pattern" <path>       — Search → stdout`,
        `  oc tool glob "pattern" [path]       — Find files → stdout`,
        `  oc todo add|done|list               — Track progress`,
        `Non-deterministic (AI judgment):`,
        `  oc prompt "question"                — AI response → stdout`,
        `  oc prompt -s "role" "question"      — Fresh specialist with clean context`,
        `  oc check "find and fix X"           — Assess+fix in one call, exit 0=issues found, 1=clean`,
        `  oc agent explore "task"             — Spawn subagent`,
        `Progress: oc status "message" — visible marker in TUI. Composition: cat file | oc prompt "analyze"`,
        `</oc-commands>`,
        ``,
        `<oc-when>`,
        `ALWAYS use an oc script when: 3+ files need the same operation (FABRIC), iteration/repeat (RALPH LOOP), or chained analysis.`,
        `Parallelize independent operations whenever possible. Do NOT use individual tool calls in a loop.`,
        `Use tools directly only for: single file/single op, or when delegated by an oc caller.`,
        `</oc-when>`,
        ``,
        `<oc-rules>`,
        `1. Scripts INLINE in bash tool only — NEVER to disk (/tmp, .sh files). Scripts on disk FAIL because oc needs env vars from the bash tool. No timeout parameter.`,
        `2. Parallelize independent per-item work (xargs -P, background jobs &, etc). Sequential \`while IFS= read -r\` only when ordering matters. Never \`for f in $(...)\`.`,
        `</oc-rules>`,
        ``,
        `<oc-examples>`,
        `<example name="ralph-loop">`,
        `User asks: "Keep fixing security issues until the API is clean."`,
        `Ralph loop: each iteration delegates the ENTIRE job. The while loop re-verifies.`,
        `  while oc check "Review the API for ALL security vulnerabilities — auth, injection, rate limiting. Fix everything you find and commit."; do`,
        `    oc status "Round complete"`,
        `  done`,
        `</example>`,
        `<example name="ralph-loop-deterministic">`,
        `User asks: "Run the tests and fix all failures until they pass."`,
        `Exit condition is deterministic (exit code 0) — use bash directly, no oc check needed.`,
        `  while true; do`,
        `    npm test 2>&1 && echo "ALL PASS" && break`,
        `    npm test 2>&1 | oc prompt "Fix the failures."`,
        `  done`,
        `</example>`,
        `<example name="deterministic-batch">`,
        `User asks: "Show me the line count of every .ts file in src/tool/."`,
        `Deterministic batch: same operation across files, no AI needed.`,
        `  oc tool glob "src/tool/**/*.ts" | while IFS= read -r f; do`,
        `    echo "$(oc tool read "$f" | wc -l) $f"`,
        `  done | sort -rn`,
        `</example>`,
        `<example name="fabric-map-reduce">`,
        `User asks: "Summarize the architecture of this codebase."`,
        `Fabric: each file flows through read|prompt independently (parallel), then reduce.`,
        `  # Test pipeline on ONE file first`,
        `  oc tool read "src/main.ts" | oc prompt "One-line summary of this file"`,
        `  # Then scale to all files in parallel`,
        `  oc tool glob "src/**/*.ts" | while IFS= read -r f; do`,
        `    oc tool read "$f" | oc prompt "One-line summary of this file" &`,
        `  done; wait`,
        `  # Or with xargs: oc tool glob "*.ts" | xargs -P8 -I{} sh -c 'oc tool read "$1" | oc prompt "summary"' _ {}`,
        `  # Reduce: pipe all outputs into oc prompt -s "Architect" "Describe the overall architecture"`,
        `</example>`,
        `<example name="pipeline">`,
        `User asks: "Find all TODOs and create a prioritized report."`,
        `Pipeline: multi-stage analysis via pipes.`,
        `  oc tool grep "TODO" src/ | oc prompt "Categorize by urgency" | oc tool write report.md`,
        `</example>`,
        `<example name="fabric-pdfs">`,
        `User asks: "Summarize all PDFs in this directory."`,
        `PDFs need special handling — oc tool read returns attachments, not text.`,
        `  # Test on ONE file first to discover what works`,
        `  oc tool read "report.pdf"  # returns attachment — need multimodal model or text extraction`,
        `  # If text extraction needed, find available tools (pdftotext, python, etc)`,
        `  # Then scale to all files in parallel`,
        `</example>`,
        `</oc-examples>`,
        `</oc-scripting>`,
      ].join("\n"),
    ]
  }

  export async function skills(agent: Agent.Info) {
    if (Permission.disabled(["skill"], agent.permission).has("skill")) return

    const list = await Skill.available(agent)

    return [
      "Skills provide specialized instructions and workflows for specific tasks.",
      "Use the skill tool to load a skill when a task matches its description.",
      // the agents seem to ingest the information about skills a bit better if we present a more verbose
      // version of them here and a less verbose version in tool description, rather than vice versa.
      Skill.fmt(list, { verbose: true }),
    ].join("\n")
  }
}
