import REQ_CONTEXT from "./skills/req-context/SKILL.md" with { type: "text" }
import SCORE_CANDIDATE from "./skills/score-candidate/SKILL.md" with { type: "text" }
import DRAFT_OUTREACH from "./skills/draft-outreach/SKILL.md" with { type: "text" }
import PROPOSE_DISPOSITION from "./skills/propose-disposition/SKILL.md" with { type: "text" }

function skill(raw: string) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) throw new Error("hiring skill missing frontmatter")
  const name = match[1].match(/^name:\s*(.+)$/m)?.[1]?.trim()
  const description = match[1].match(/^description:\s*(.+)$/m)?.[1]?.trim()
  if (!name || !description) throw new Error("hiring skill frontmatter requires name and description")
  return { name, description, content: match[2].trim() }
}

export const HiringSkills = [
  skill(REQ_CONTEXT),
  skill(SCORE_CANDIDATE),
  skill(DRAFT_OUTREACH),
  skill(PROPOSE_DISPOSITION),
] as const
