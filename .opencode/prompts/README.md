# OpenCode Prompt Files

This folder defines reusable prompt menu items for OpenCode.

Use these files to create high-quality prompts with clear names, short subtitles, and structured templates.

Important: prompts should work when pasted as-is. Do not assume users selected code first.

## Functional Packs

Organize prompts by function. Each file is a section in the prompt menu.

- `code-review.json` (`🔍`) review and quality gates
- `engineering.json` (`🛠`) implementation and refactoring
- `planning.json` (`🧭`) discovery, spec, architecture, and delivery planning
- `ai.json` (`🤖`) AI workflow design, evaluation, safety, and rollout
- `qa.json` (`🧪`) testing strategy and regression prevention
- `troubleshooting.json` (`🧭`) incident triage and debugging
- `performance.json` (`⚡`) latency, scalability, and profiling
- `security.json` (`🔐`) threat modeling, hardening, and release gating
- `web-design.json` (`🎨`) UX, accessibility, and interface polish
- `documentation.json` (`📝`) architecture, guides, and runbooks
- `delivery.json` (`🚀`) release, migration, and rollout workflows

## Folder Layout

Use one of these locations:

- `.opencode/prompts/*.json`
- `.opencode/prompts/custom/*.json`

For best compatibility across app views, keep prompt JSON files in the root `prompts` folder or in `prompts/custom`.

## Environment Context Helper

This fork includes a capability scan script to generate startup context for AI prompts.

Run from repo root:

```bash
bun run env:scan
```

It writes:

- `.opencode/context/env-capabilities.json`
- `.opencode/context/env-capabilities.md`

Use these files in AI/system prompts to improve tool-aware planning (available runtimes, package managers, open-file tools, conversion tools, etc.).

## JSON Format

Each file should follow this shape:

```json
{
  "version": "1.0",
  "category": "code-review",
  "categoryIcon": "🔍",
  "prompts": [
    {
      "id": "quick-code-review",
      "name": "Quick Code Review",
      "summary": "Fast, high-signal review with prioritized fixes",
      "description": "Legacy fallback subtitle",
      "template": "Review this code:\n\n{{selection}}",
      "tags": ["review", "quality"]
    }
  ]
}
```

## Field Reference

Top-level fields:

- `version` (optional): arbitrary version string for your own tracking
- `category` (optional): category label source; UI converts `kebab_case`/`snake_case` to title case
- `categoryIcon` (optional): icon shown next to the category label
- `prompts` (required): array of prompt entries

Prompt entry fields:

- `id` (required): stable unique prompt key
- `name` (required): primary label shown in the menu
- `template` (required): inserted prompt text
- `summary` (optional, preferred): short subtitle shown under the name in menus
- `description` (optional, legacy): backward-compatible fallback when `summary` is missing
- `tags` (optional): list of tags used by search/filter

Subtitle fallback order:

1. `summary`
2. `description`
3. no subtitle

## Supported Placeholders

These placeholders are replaced when a prompt is applied:

- `{{selection}}` -> selected text in the active editor context
- `{{clipboard}}` -> clipboard text

Use placeholders as optional enrichment. Prompts should still be useful when placeholders are empty.

## Validation and Loading Rules

- Invalid JSON files are skipped.
- Files without a valid `prompts` array are skipped.
- Prompt entries missing `id`, `name`, or `template` are skipped.
- Valid files and valid entries still load even if other files are broken.

## Search Behavior

Prompt search matches against:

- `name`
- `summary` (or `description` fallback)
- `category`
- `tags`
- `template`

## Examples

### Minimal File

```json
{
  "version": "1.0",
  "category": "review",
  "prompts": [
    {
      "id": "quick-review",
      "name": "Quick Review",
      "summary": "Spot high-risk issues quickly",
      "template": "Review the code I am currently working on for correctness and risk."
    }
  ]
}
```

### Multi-Prompt Category File

```json
{
  "version": "1.0",
  "category": "delivery",
  "categoryIcon": "🚀",
  "prompts": [
    {
      "id": "commit-message",
      "name": "Commit Message",
      "summary": "Generate a concise commit with rationale",
      "template": "Write a commit message for current changes with why + risks."
    },
    {
      "id": "pr-summary",
      "name": "PR Summary",
      "summary": "Create a reviewer-friendly PR description",
      "template": "Draft a PR summary with sections: Why, What, Validation, Risks."
    }
  ]
}
```

### Custom Prompt File

```json
{
  "version": "1.0",
  "category": "custom",
  "categoryIcon": "✨",
  "prompts": [
    {
      "id": "incident-rca",
      "name": "Incident RCA",
      "summary": "Root-cause analysis with evidence and follow-ups",
      "template": "Analyze the incident I am currently investigating and produce RCA, mitigations, and tests."
    }
  ]
}
```

## Best Practices for High-Quality Prompts

- Start templates with a role + operating expectations block to improve consistency.
- Start with a precise job: review, debug, summarize, refactor, plan.
- Define output format explicitly (sections, bullets, checklist, table).
- Add constraints (length, risk focus, coding standards, acceptance criteria).
- Prefer one purpose per prompt; split broad workflows into multiple prompts.
- Keep `summary` short and specific (it is what users scan in the menu).
- Use stable `id` values; treat them as identifiers, not display text.

Recommended preamble pattern:

```text
You are a senior <discipline> assistant helping with production-quality software work.

Operating expectations:
- Be precise, practical, and evidence-driven.
- Prioritize correctness, security, reliability, and maintainability over style preference.
- If context is missing, state assumptions explicitly and continue with best-effort guidance.
- Do not invent facts; call out uncertainty and what to verify.
- Return concise, prioritized output with clear next actions.
```

## Troubleshooting

If prompts do not appear:

- Verify JSON syntax.
- Ensure file is in `.opencode/prompts` or `.opencode/prompts/custom`.
- Confirm each prompt has `id`, `name`, and `template`.
- Check for accidental empty strings or wrong types.

If subtitle text is missing:

- Add `summary`, or
- Keep `description` for legacy fallback.
