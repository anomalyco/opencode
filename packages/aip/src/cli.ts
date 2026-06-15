#!/usr/bin/env bun
import {
  AnthropicClient,
  MockLLMClient,
  loadDataset,
  loadSkill,
  offlineResponder,
  type LLMClient,
} from "@opencode-ai/evolve"
import { createOntology } from "./objects.ts"
import { obj } from "./ontology.ts"
import { describeSubgraph, expand } from "./graph.ts"
import { defaultActions } from "./actions.ts"
import { propose } from "./propose.ts"
import { AutoReviewer, merge, openBranch, review } from "./governance.ts"
import { learn } from "./dynamic.ts"

interface Args {
  query: string
  mock: boolean
  skill?: string
  dataset?: string
}

function parseArgs(argv: string[]): Args {
  const args: Args = { query: "", mock: false }
  const positional: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--mock") args.mock = true
    else if (a === "--skill") args.skill = argv[++i]
    else if (a === "--dataset") args.dataset = argv[++i]
    else positional.push(a)
  }
  args.query = positional.join(" ")
  return args
}

/** A tiny demo ontology so the pipeline has a graph to traverse out of the box. */
function demoOntology() {
  const ontology = createOntology()
  ontology
    .upsert(obj("Session", "ses_1", { title: "fix flaky tests", cost: 0.42, status: "working" }))
    .upsert(obj("Agent", "agent_build", { name: "build", model: "claude-sonnet-4-6" }))
    .upsert(obj("Skill", "skill_git", { name: "git-commit", description: "good commits", path: "", passRate: 0.25 }))
    .upsert(obj("Tool", "tool_bash", { name: "bash", description: "run shell commands" }))
    .link("runs", "ses_1", "agent_build")
    .link("has-skill", "agent_build", "skill_git")
    .link("has-tool", "agent_build", "tool_bash")
  return ontology
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  if (cmd !== "query") {
    console.log('Usage: aip query "<text>" [--mock] [--skill <SKILL.md> --dataset <dataset.json>]')
    process.exit(cmd ? 1 : 0)
  }
  const args = parseArgs(rest)
  if (!args.query) {
    console.error('error: a query is required, e.g. aip query "improve the git-commit skill" --mock')
    process.exit(1)
  }

  const ontology = demoOntology()
  const actions = defaultActions()

  // 1) Semantic layer + graph traversal: relevant subgraph around the session.
  const graph = expand(ontology, "ses_1", 2)
  console.log("== Semantic layer (subgraph) ==")
  console.log(describeSubgraph(graph))

  // 2) LLM proposes an action over the subgraph.
  const useMock = args.mock || !process.env.ANTHROPIC_API_KEY
  const proposeLLM: LLMClient = useMock
    ? new MockLLMClient(() =>
        JSON.stringify({
          action: "answer",
          params: { text: `Considering ${graph.objects.length} objects for: ${args.query}` },
          rationale: "offline demo proposer",
        }),
      )
    : new AnthropicClient()

  const result = await propose(proposeLLM, { query: args.query, subgraph: graph, actions })
  console.log("\n== Kinetic layer (proposed action) ==")
  console.log(`action: ${result.proposal.action}`)
  console.log(`params: ${JSON.stringify(result.proposal.params)}`)
  if (result.validationError) console.log(`validation: ${result.validationError}`)

  // 3) Governance: open a branch, review, merge (write back).
  const action = actions.get(result.proposal.action)
  if (action && !result.validationError) {
    const change = await action.propose({ ontology, query: args.query }, result.proposal.params)
    const branch = openBranch(action, change, result.proposal.rationale)
    const reviewed = await review(branch, new AutoReviewer(["aip.answer", "aip.skill.update", "aip.object.update"]))
    console.log("\n== Governance (action branch) ==")
    console.log(`branch ${reviewed.id}: ${reviewed.status}${reviewed.feedback ? ` (${reviewed.feedback})` : ""}`)
    const mergeResult = merge(reviewed, { ontology })
    console.log(`merge: ${mergeResult.effect}`)
  }

  // 4) Dynamic layer: learn from outcomes, update ontology, stage write-back branches.
  if (args.skill && args.dataset) {
    const skill = loadSkill(args.skill)
    const dataset = loadDataset(args.dataset)
    ontology.upsert(obj("Skill", "skill_target", { name: skill.name, path: args.skill, passRate: 0 }))
    const learnLLM = useMock ? new MockLLMClient(offlineResponder(dataset)) : proposeLLM
    const learned = await learn(ontology, [{ skillId: "skill_target", skill, dataset }], { llm: learnLLM })
    console.log("\n== Dynamic layer (learn from outcome) ==")
    for (const u of learned.updates) console.log(`updated ${u.id}.${u.property}: ${u.before} → ${u.after}`)
    for (const b of learned.branches) {
      console.log(`staged branch ${b.id}: ${b.change.summary}`)
      const reviewed = await review(b, new AutoReviewer(["aip.skill.update"]))
      const mergeResult = merge(reviewed, { ontology })
      console.log(`  ${reviewed.status} → ${mergeResult.effect}`)
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exit(1)
})
