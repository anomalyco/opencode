// Built-in workflows shipped with opencode. Each entry maps a workflow NAME to
// its module SOURCE TEXT (a string, never a file on disk). This is the
// binary-safe form: the source travels inside the compiled bundle as a plain
// string constant, so there is no separate `.ts`/`.js` file that a packaged
// binary would have to ship alongside itself and locate at runtime.
//
// INVARIANT: builtin sources must be SELF-CONTAINED — no imports. start()
// materializes them as temp modules under the global workflows directory, so a
// bare specifier would resolve through whatever node_modules sits above that
// directory: the PUBLISHED `@opencode-ai/plugin` that config.ts installs there,
// never a dev workspace checkout (PR #2 review: a contributor had to manually
// link the workspace plugin globally before an import-using builtin would load).
// Import-free sources load identically in dev, in tests, and in the compiled
// binary. The wrapper-free `export default { meta, run }` shape is exactly what
// the plugin's workflow() helper returns at runtime, and the static MetaReader
// reads it natively (form 2) — the wrapper only ever added editor types, which a
// string constant cannot benefit from anyway.
//
// Discovery treats these as the LOWEST-precedence root (project > global >
// builtin): a builtin name is only ever surfaced when no project or global file
// already claims that name (first-wins in `discover`). The static `MetaReader`
// reads meta straight from the source string (it already takes `source`
// directly), and `start()` loads the module from the source string via the same
// temp-file import path that on-disk workflows use — so a builtin runs through
// the identical permission gate and argument-coercion boundary as any file.
//
// The synthetic path marker for a builtin is `builtin:<name>` (see
// BUILTIN_PATH_PREFIX); it is never a real filesystem path and is only used as a
// stable identifier on the Info/Definition record.

export const BUILTIN_PATH_PREFIX = "builtin:"

export function builtinPath(name: string) {
  return `${BUILTIN_PATH_PREFIX}${name}`
}

export function isBuiltinPath(path: string) {
  return path.startsWith(BUILTIN_PATH_PREFIX)
}

// The synthetic path marker for an INLINE-source workflow is `inline:<metaName>`
// (P3). Like `builtin:`, it is never a real filesystem path: an inline start
// supplies the module source directly, loaded through the SAME source-string
// import path builtins use (loadModule materializes a randomized temp module
// under the global workflows dir). Discovery globs real `*.ts` files only, so an
// `inline:` marker — exactly like `builtin:` — can never be picked up as a
// discovered workflow.
export const INLINE_PATH_PREFIX = "inline:"

export function inlinePath(name: string) {
  return `${INLINE_PATH_PREFIX}${name}`
}

export function isInlinePath(path: string) {
  return path.startsWith(INLINE_PATH_PREFIX)
}

// deep-research: fan out a question into distinct search angles, research each
// in parallel, adversarially verify every claim against its cited sources, then
// synthesize a cited report from only the surviving claims. The meta fields are
// LITERALS so the static meta reader can extract name/description/phases/
// arguments without executing the module.
const DEEP_RESEARCH = `export default {
  meta: {
    name: "deep-research",
    description: "Research a question across angles with adversarial claim verification",
    phases: ["plan", "research", "verify", "synthesize"],
    arguments: { question: { type: "string" } },
  },
  async run(args, ctx) {
    const question = String(args.question ?? "")
    if (!question) throw new Error("deep-research needs args.question")

    ctx.setPhase("plan")
    const plan = await ctx.agent({
      prompt: \`Break this research question into 3-5 distinct search angles. Question: \${question}. Respond ONLY via the schema.\`,
      schema: {
        type: "object",
        required: ["angles"],
        properties: { angles: { type: "array", minItems: 3, maxItems: 5, items: { type: "string" } } },
      },
    })

    ctx.setPhase("research")
    // ctx.parallel drops a rejecting/agent-erroring task to null at its position
    // (P1 Claude parity) — filter before dereferencing the findings.
    const findings = (await ctx.parallel(
      plan.data.angles.map((angle) => () =>
        ctx.agent({
          prompt: \`Research this angle using your available web/search tools. If NO web/search tools are available, return {"claims": [], "no_web_tools": true} via the schema. Angle: \${angle}\\nFull question: \${question}\\nReturn findings with source URLs via the schema.\`,
          schema: {
            type: "object",
            required: ["claims"],
            properties: {
              claims: {
                type: "array",
                items: {
                  type: "object",
                  required: ["claim", "sources"],
                  properties: {
                    claim: { type: "string" },
                    sources: { type: "array", items: { type: "string" } },
                  },
                },
              },
              no_web_tools: { type: "boolean" },
            },
          },
        }),
      ),
    )).filter((f) => f !== null)
    // Gate via the structured schema (a forced-JSON schema makes the old plaintext
    // sentinel unreachable — StructuredOutputError would fire before any reply
    // text could carry it). An agent with no web/search tools instead sets the
    // optional no_web_tools flag, which we surface as an honest hard failure.
    if (findings.some((f) => (f.data as { no_web_tools?: boolean }).no_web_tools))
      throw new Error("deep-research requires web/search tools to be available to agents")

    const claims = findings.flatMap((f) => f.data.claims)

    ctx.setPhase("verify")
    // Same null-drop contract here — filter the verdicts before dereferencing.
    const verified = (await ctx.parallel(
      claims.map((c) => () =>
        ctx
          .agent({
            prompt: \`Adversarially verify this claim against its sources (fetch them). Claim: \${c.claim}\\nSources: \${c.sources.join(", ")}\\nReply via schema: supported=true only if the sources actually back the claim.\`,
            schema: {
              type: "object",
              required: ["supported", "reason"],
              properties: { supported: { type: "boolean" }, reason: { type: "string" } },
            },
          })
          .then((v) => ({ ...c, verdict: v.data })),
      ),
      { concurrencyLimit: 8 },
    )).filter((v) => v !== null)
    const surviving = verified.filter((c) => c.verdict.supported)
    const rejected = verified.filter((c) => !c.verdict.supported)

    ctx.setPhase("synthesize")
    const report = await ctx.agent({
      prompt: \`Write a cited research report answering: \${question}\\nUse ONLY these verified claims (cite their sources inline): \${JSON.stringify(surviving)}\\nList rejected claims briefly at the end: \${JSON.stringify(rejected.map((r) => ({ claim: r.claim, reason: r.verdict.reason })))}\`,
    })

    return { report: report.text, claims: { verified: surviving.length, rejected: rejected.length } }
  },
}
`

// name -> module source text. Keep insertion order stable; discovery sorts by
// name so the order here is not load-bearing.
export const BUILTIN_WORKFLOWS: Record<string, string> = {
  "deep-research": DEEP_RESEARCH,
}
