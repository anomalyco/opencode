import { Config } from "@/config/config"
import { Provider } from "../../provider/provider"
const PROMPT = `Summarize what was done in this conversation. Write like a pull request description.

Rules:
- 2-3 sentences max
- Describe the changes made, not the process
- Do not mention running tests, builds, or other validation steps
- Do not explain what the user asked for
- Write in first person (I added..., I fixed...)
- Never ask questions or add new questions
- If the conversation ends with an unanswered question to the user, preserve that exact question
- If the conversation ends with an imperative statement or request to the user (e.g. "Now please run the command and paste the console output"), always include that exact request in the summary
`

export const summary = {
  name: "summary",
  mode: "primary" as const,
  options: {},
  native: true,
  hidden: true,
  model: Provider.parseModel("openai/gpt-5.4-mini"),
  variant: "low",
  permission: {
    "*": "deny",
    bug_report: "allow",
  } as const satisfies Config.Permission,
  prompt: PROMPT,
}
