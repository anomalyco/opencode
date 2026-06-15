export type SkillProposalDraft = {
  name: string
  description: string
  body: string
  reason: string
}

export type ReplayToolEvent =
  | { readonly type: "called"; readonly tool: string; readonly callID: string }
  | { readonly type: "failed"; readonly callID: string }
  | { readonly type: "success"; readonly callID: string }
  | { readonly type: "input_ended"; readonly text: string }

const correctionPattern =
  /\b(wrong|instead|not what|try again|fix that|that's incorrect|use a different)\b/i

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)

const repeatedToolProposal = (counts: Map<string, number>): SkillProposalDraft | undefined => {
  const [tool, count] = [...counts.entries()].sort((left, right) => right[1] - left[1])[0] ?? []
  if (!tool || count < 3) return undefined
  if (tool === "Skill" || tool === "skill") return undefined
  const name = `${tool} workflow`
  return {
    name,
    description: `Use when repeating ${tool} calls in a session loop`,
    reason: `${tool} was called ${count} times without a matching skill`,
    body: [
      `# ${name}`,
      "",
      `This skill was proposed because the \`${tool}\` tool ran ${count} times in one session.`,
      "",
      "## When to use",
      "",
      `- You are about to call \`${tool}\` again for a similar task`,
      `- Prior attempts used the same tool in a tight loop`,
      "",
      "## Steps",
      "",
      "1. Confirm the goal before invoking the tool again.",
      "2. Reuse prior successful inputs when the task is unchanged.",
      "3. Stop after the workflow succeeds instead of repeating blindly.",
    ].join("\n"),
  }
}

const failSuccessProposal = (events: ReplayToolEvent[]): SkillProposalDraft | undefined => {
  const failed = new Set<string>()
  let recoveries = 0
  for (const event of events) {
    if (event.type === "failed") failed.add(event.callID)
    if (event.type === "success" && failed.has(event.callID)) recoveries += 1
  }
  if (recoveries < 1) return undefined
  const name = "recover-after-tool-failure"
  return {
    name,
    description: "Use after a tool fails then succeeds on retry",
    reason: `${recoveries} tool call(s) failed before succeeding`,
    body: [
      "# Recover after tool failure",
      "",
      "This skill was proposed because the session retried tools after failures.",
      "",
      "## When to use",
      "",
      "- A tool call failed and was retried successfully",
      "- You need a short checklist before repeating the same command",
      "",
      "## Steps",
      "",
      "1. Read the failure output and adjust inputs.",
      "2. Retry once with the smallest possible change.",
      "3. Record what fixed the failure for the next turn.",
    ].join("\n"),
  }
}

const correctionProposal = (events: ReplayToolEvent[]): SkillProposalDraft | undefined => {
  const corrections = events.filter(
    (event) => event.type === "input_ended" && correctionPattern.test(event.text),
  )
  if (corrections.length < 1) return undefined
  const name = "apply-user-corrections"
  return {
    name,
    description: "Use when the user corrects a prior assistant action",
    reason: `${corrections.length} user correction(s) detected in tool input`,
    body: [
      "# Apply user corrections",
      "",
      "This skill was proposed because the user steered the assistant after tool input.",
      "",
      "## When to use",
      "",
      "- The user says the prior result was wrong or not what they wanted",
      "- You need to adjust the next tool call based on explicit feedback",
      "",
      "## Steps",
      "",
      "1. Restate the correction in your own words.",
      "2. Change only the inputs the user flagged.",
      "3. Confirm the next action matches the corrected intent.",
    ].join("\n"),
  }
}

export const analyze = (events: ReplayToolEvent[]): SkillProposalDraft | undefined => {
  const counts = new Map<string, number>()
  for (const event of events) {
    if (event.type !== "called") continue
    counts.set(event.tool, (counts.get(event.tool) ?? 0) + 1)
  }
  return (
    repeatedToolProposal(counts) ??
    failSuccessProposal(events) ??
    correctionProposal(events)
  )
}

export const toSlug = (draft: SkillProposalDraft) => slugify(draft.name)
