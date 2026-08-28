export * as AutoDrive from "./auto-drive"

export const DEFAULT_MAX_RUNS = 5
export const DEFAULT_PROMPT = "Please proceed with the next step."
export const MEMORY_RELATIVE_PATH = ".opencode/auto-drive.md"

export interface Context {
  readonly initialGoal?: string
  readonly lastText: string
  readonly playbookMarkdown?: string
  readonly customPrompt?: string
  readonly contextual?: boolean
}

export interface Decision {
  readonly continue: boolean
  readonly reason?: string
  readonly nextPrompt: string
  readonly updateMemory?: string
}

// Continuation detection patterns (evaluated on the trailing chunk / concluding text of the assistant message)
const CONTINUATION_PATTERNS = [
  // English questions asking to continue
  /(?:would you like|do you want|should I|shall I)(?:\s+me)?\s+to\s+(?:continue|proceed|move on|take the next step|start)/i,
  /let me know if you(?:'d| would)? like (?:me )?to (?:continue|proceed)/i,
  /please (?:reply|type|say|send)\s+["']?continue["']?/i,
  // English next steps statements
  /(?:^|\n)\s*(?:next steps?|upcoming steps?|remaining tasks?)[：:]/i,
  /(?:next|then|now),?\s+I (?:will|shall|can|am ready to) (?:proceed to|continue with|start|implement|create|update|add|test|fix|run)/i,
  /ready to (?:proceed with|continue with|start|move to) (?:the next step|the implementation|the next phase)/i,
  // Chinese questions asking to continue
  /(?:是否|要不要|需要|如需|请确认是否)(?:继续|进行下一步|执行下一步|推进|开始下一步)/i,
  /(?:回复|输入|发送)["'“‘]?(?:继续|下一步)["'”’]?/i,
  // Chinese next steps statements
  /(?:下一步|后续)(?:计划|步骤|工作|安排|任务|操作)[：:]/i,
  /(?:接下来|下一步|随后|紧接着)(?:我将|我们将|准备|会|需要|打算)(?:继续|开始|执行|实现|修改|创建|添加|测试|排查|编写|完善)/i,
  // Maximum steps reached notices
  /maximum(?: number of)? steps(?: allowed)?.*reached/i,
  /达到(?:最大)?步数限制/i,
]

// Patterns that indicate user decision / multiple choice is needed (should NOT blindly auto-continue)
const CHOICE_PROMPT_PATTERNS = [
  /(?:which (?:option|approach|alternative|one)|please choose|please select|let me know which)/i,
  /(?:请选择|你希望|你想要|哪种方案|哪个选项|请确认以下方案)/i,
]

// Completion patterns that indicate everything is finished
const COMPLETION_PATTERNS = [
  /(?:all tasks (?:are )?completed|everything is (?:done|complete)|all steps have been completed)/i,
  /(?:所有任务已全部完成|已完成全部工作|全部实施完毕|已顺利完成|任务全部完成)/i,
]

export const detect = (text: string): boolean => {
  if (!text || text.trim().length === 0) return false

  const trimmed = text.trim()
  const tail = trimmed.length > 1500 ? trimmed.slice(-1500) : trimmed

  // If asking user to choose between specific options, do not auto-drive
  if (CHOICE_PROMPT_PATTERNS.some((pattern) => pattern.test(tail))) {
    return false
  }

  // If explicitly stated that all tasks are finished and no continuation requested
  if (
    COMPLETION_PATTERNS.some((pattern) => pattern.test(tail)) &&
    !/(?:continue|proceed|继续|是否继续)/i.test(tail)
  ) {
    return false
  }

  return CONTINUATION_PATTERNS.some((pattern) => pattern.test(tail))
}

export const promptFor = (input: Context | string): string => {
  if (typeof input === "string") return input.trim().length > 0 ? input : DEFAULT_PROMPT
  if (input.customPrompt && input.customPrompt.trim().length > 0) return input.customPrompt
  if (input.contextual && input.initialGoal && input.initialGoal.trim().length > 0) {
    const snippet = input.initialGoal.trim().slice(0, 150).replace(/\n/g, " ")
    return `[Auto-Drive Directive] Focus on the initial task goal "${snippet}", align with current progress and planned next steps, and proceed autonomously.`
  }
  return DEFAULT_PROMPT
}

export const buildSupervisorPrompt = (context: Context): string => {
  const goal = context.initialGoal?.trim() || "(No explicit initial goal provided)"
  const memory = context.playbookMarkdown?.trim() || "(No accumulated strategy memory yet)"
  const lastExcerpt = context.lastText.trim().slice(-2000)

  return `You are the Auto-Drive Supervisor for an autonomous software engineering session.
A primary worker agent just completed its current turn.
Analyze whether the worker has remaining tasks, next steps, or unverified work, or if it should stop.

<InitialUserGoal>
${goal}
</InitialUserGoal>

<AutoDriveMemory>
${memory}
</AutoDriveMemory>

<WorkerLastOutput>
${lastExcerpt}
</WorkerLastOutput>

Decision Rules:
1. "continue": true if the worker explicitly stated upcoming steps, requested confirmation to proceed, or has obvious unfinished milestones towards the initial goal.
2. "continue": false if the entire user goal is completely achieved and verified, or if the worker requires a subjective decision/choice from the human user.
3. "next_prompt": If continuing, provide a concise, actionable instruction directing the worker on what exact step to take next. If custom prompt is provided, incorporate it.
4. "update_memory": Optional. If the worker achieved a milestone or clarified a new rule/checklist, return an updated summary section for the memory file. Otherwise omit or null.

Respond ONLY with a valid JSON object matching this schema:
{
  "continue": boolean,
  "reason": string,
  "next_prompt": string,
  "update_memory": string | null
}`
}

export const parseSupervisorDecision = (raw: string, context: Context): Decision => {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      if (typeof parsed.continue === "boolean") {
        return {
          continue: parsed.continue,
          reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
          nextPrompt:
            typeof parsed.next_prompt === "string" && parsed.next_prompt.trim().length > 0
              ? parsed.next_prompt
              : promptFor(context),
          updateMemory:
            typeof parsed.update_memory === "string" && parsed.update_memory.trim().length > 0
              ? parsed.update_memory
              : undefined,
        }
      }
    }
  } catch {
    // Fall back to heuristic detection
  }

  const shouldContinue = detect(context.lastText)
  return {
    continue: shouldContinue,
    reason: shouldContinue ? "Heuristic continuation detected" : "No continuation cues found",
    nextPrompt: promptFor(context),
  }
}

export const defaultPlaybookTemplate = (projectName?: string): string => {
  const name = projectName || "Project"
  return `# ${name} Auto-Drive Playbook & Memory

## 1. Core Principles & Engineering Standards
* Autonomously advance tasks while ensuring complete implementation and self-verification.
* Prioritize analyzing and resolving build or test errors independently.
* Maintain clean, concise commits and document significant architectural changes.

## 2. Active Roadmap & Task Checklist
- [ ] Initial planning and setup
- [ ] Core logic implementation
- [ ] Automated testing and verification

## 3. Learned Patterns & Project Conventions
- Follow repository code style, linting, and type conventions.
`
}
