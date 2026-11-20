export * as OpencodeMemoryRecipe from "./opencode-memory-recipe.js"

/**
 * A repository's test recipe, taken from what the harness saw rather than from a model: the command that made the tests
 * run and pass after a different one failed. Agents chain their commands (`cd x && a && b 2>&1 | tail; echo $?`), so a
 * chain is reduced to its setup, build and test steps, in order, as one command another session can rerun, and whether
 * it passed is read from its output as well as its exit code (a trailing `echo` hides the exit code).
 */

const STEP =
  /\b(?:pytest|unittest|tox|nox|vitest|jest|mocha|go test|cargo (?:test|build)|run-tests|tests?|pip3? install|uv (?:sync|pip)|npm (?:ci|install|run|test)|bun (?:install|run|test)|poetry install|make|bootstrap|setup|gen|regen|build|compile)\b/
const TEST = /\b(?:pytest|unittest|tox|nox|vitest|jest|mocha|go test|cargo test|run-tests|tests?)\b/
const NOISE =
  /^(?:cd|echo|ls|cat|git|pwd|sed|grep|rg|find|head|tail|printf|true|false|set|wc|sort|diff|rm|mkdir|which|env|export|sleep)\b/
const COMMAND = /`[^`]{3,}`|\.\/[\w.-]+|\bpython3? (?:-m )?\S+|\bmake \w+|\b(?:npm|bun|pnpm|yarn) (?:run )?\w+/
const ABOUT = /\b(?:tests?|unittest|pytest|set ?up|setup|bootstrap|build|lint)\b/i

/** The setup, build and test steps of a command or chain, in order, without `cd`, output plumbing or echoes. */
export const steps = (command: string) =>
  command
    .split(/\s*(?:&&|\|\||;|\n)\s*/)
    .map((one) =>
      one
        .split(/\s\|\s/)[0]
        .replace(/\s*\d?>&\d|\s*2>\/dev\/null|\s*>\s*\S+$/g, "")
        .trim(),
    )
    .filter((one) => one !== "" && !NOISE.test(one) && STEP.test(one))

/** Whether a finished run's output shows tests that ran and passed. */
export const passed = (output: string) =>
  /Ran [1-9]\d* tests?[\s\S]*\bOK\b|\b[1-9]\d* pass(?:ed|ing)\b/.test(output) &&
  !/FAILED|\b[1-9]\d* fail(?:ed|ing|ures?)\b/.test(output)

export interface State {
  readonly failed: string[]
  found: boolean
}

export const make = (): State => ({ failed: [], found: false })

/**
 * The recipe a finished shell call shows, once per session: a test run that passed after a different one failed in
 * the same session. Anything else only updates `state`.
 */
export const observe = (
  state: State,
  run: { readonly command: string; readonly output: string; readonly failed: boolean },
) => {
  const recipe = steps(run.command).join(" && ")
  if (!steps(recipe).some((one) => TEST.test(one))) return undefined
  if (run.failed || !passed(run.output)) {
    state.failed.push(recipe)
    return undefined
  }
  const before = state.failed.findLast((one) => one !== recipe)
  if (state.found || before === undefined) return undefined
  state.found = true
  return { recipe, before }
}

/** The entry a recipe becomes for repository `repo`. */
export const entry = (found: { readonly recipe: string; readonly before: string }, repo: string) => ({
  kind: "procedure" as const,
  title: `To test ${repo}, run \`${found.recipe}\``.slice(0, 200),
  body: `In ${repo}, run the tests with \`${found.recipe.slice(0, 300)}\`: it passed after \`${found.before.slice(0, 200)}\` failed.`,
})

/**
 * A repository rule that is its recipe: a procedure that carries a command and is about testing, setting up or building
 * the repository. At a task's start it goes first among the rules, so the agent has the working command before its
 * first attempt rather than after a failure.
 */
export const isRecipe = (entry: {
  readonly kind: string
  readonly title: string
  readonly body: string
  readonly via?: string
}) =>
  entry.kind === "procedure" &&
  entry.via === "repository" &&
  COMMAND.test(`${entry.title}\n${entry.body}`) &&
  ABOUT.test(entry.title)
