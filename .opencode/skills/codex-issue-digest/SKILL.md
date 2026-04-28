---
name: codex-issue-digest
description: Run a GitHub issue digest for openai/codex by feature-area labels, all areas, and configurable time windows. Use when asked to summarize recent Codex bug reports or enhancement requests, especially for owner-specific labels such as tui, exec, app, or similar areas.
---

# Codex Issue Digest

## Objective

Produce a concise, insight-oriented digest of `openai/codex` issues for the requested feature-area labels over the previous 24 hours by default. Honor a different duration when the user asks for one, for example "past week" or "48 hours".

Include only issues that currently have `bug` or `enhancement` plus at least one requested owner label. If the user asks for all areas or all labels, collect `bug`/`enhancement` issues across all labels.

## Inputs

- Feature-area labels, for example `tui exec`
- `all areas` / `all labels` to scan all current feature labels
- Optional repo override, default `openai/codex`
- Optional time window, default previous 24 hours; examples: `48h`, `7d`, `1w`, `past week`

## Workflow

1. Run the collector from a current Codex repo checkout:

```bash
python3 .codex/skills/codex-issue-digest/scripts/collect_issue_digest.py --labels tui exec --window-hours 24
```

Use `--window "past week"` or `--window-hours 168` when the user asks for a non-default duration. Use `--all-labels` when the user says all areas or all labels.

2. Use the JSON as the source of truth. It includes new issues, new issue comments, new reactions/upvotes, current labels, current reaction counts, model-ready `summary_inputs`, and detailed `digest_rows`.
3. Start the report with `## Summary`, then `## Details`.
4. In `## Summary`, write skim-first headlines:
   - Lead with the most important fact or judgment. Do not start with aggregate counts unless the aggregate itself is the story.
   - Make the first 1-3 bullets answer "what should owners pay attention to right now?"
   - Bold only the critical insight phrase in each high-priority bullet, for example `**GPT-5.5 context is the dominant pressure point**`.
   - Keep summary bullets short enough to scan in about 20 seconds.
   - Put broad stats near the end of the summary, after the owner-relevant takeaways.
   - Say clearly when there is nothing significant to act on.
   - Call out any areas or themes receiving lots of user attention.
   - Cluster and name themes yourself from `summary_inputs`; the collector intentionally does not hard-code issue categories.
   - Use a cluster only when the issues genuinely share the same product problem. If several issues merely share a broad platform or label, describe them individually.
   - Do not omit a repeated theme just because its individual issues fall below the details table cutoff. Several similar reports should be called out as a repeated customer concern.
   - For single-issue rows, summarize the concern directly instead of calling it a cluster.
   - Use inline numbered issue links from each relevant row's `ref_markdown`.
5. In `## Details`, include a compact table only when useful:
   - Prefer rows from `digest_rows`; include a `Refs` column using each row's `ref_markdown`.
   - Keep the table short; omit low-signal rows when the summary already covers them.
   - Use compact columns such as marker, area, type, description, interactions, and refs.
   - The `Description` cell should be a short owner-readable phrase. Use row `description`, title, body excerpts, and recent comments, but do not mechanically copy the raw GitHub issue title when it contains incidental details.
   - A clear quiet/no-concern sentence when there is no meaningful signal.
6. Use the JSON `attention_marker` exactly. It is empty for normal rows, `🔥` for elevated rows, and `🔥🔥` for very high-attention rows. The actual cutoffs are in `attention_thresholds`.
7. Use inline numbered references where a row or bullet points to issues, for example `Compaction bugs [1](https://github.com/openai/codex/issues/123), [2](https://github.com/openai/codex/issues/456)`. Do not add a separate footnotes section.
8. Label `interactions` as `Interactions`; it counts posts/comments/reactions during the requested window, not unique people.
9. Mention the collector `script_version`, repo checkout `git_head`, and time window in the digest footer or final line.

## Reaction Handling

The collector uses GitHub reactions endpoints, which include `created_at`, to count reactions created during the digest window for hydrated issues. It reports both in-window reaction counts and current reaction totals. Treat current reaction totals as standing engagement, and treat `new_reactions` / `new_upvotes` as windowed activity.

By default, the collector fetches issue comments with `since=<window start>` and caps the number of comment pages per issue. This keeps very long historical threads from dominating a digest run and focuses the report on recent posts. Use `--fetch-all-comments` only when exhaustive comment history is more important than runtime.

GitHub issue search is still seeded by issue `updated_at`, so a purely reaction-only issue may be missed if reactions do not bump `updated_at`. Covering every reaction-only case would require either a persisted snapshot store or a broader scan of labeled issues.

## Attention Markers

The collector scales attention markers by the requested time window. The baseline is 10 human user interactions for `🔥` and 20 for `🔥🔥` over 24 hours; longer or shorter windows scale those cutoffs linearly and round up. For example, a one-week report uses 70 and 140 interactions. Human user interactions are human-authored new issue posts, human-authored new comments, and human reactions created during the window, including upvotes. Bot posts and bot reactions are excluded. In prose, explain this as high user interaction rather than naming the emoji.

## Freshness

The automation should run from a repo checkout that contains this skill. For shared daily use, prefer one of these patterns:

- Run the automation in a checkout that is refreshed before the automation starts, for example with `git pull --ff-only`.
- If the automation cannot safely mutate the checkout, have it report the current `git_head` from the collector output so readers know which skill/script version produced the digest.

## Sample Owner Prompt

```text
Use $codex-issue-digest to run the Codex issue digest for labels tui and exec over the previous 24 hours.
```

```text
Use $codex-issue-digest to run the Codex issue digest for all areas over the past week.
```

## Validation

Dry run the collector against recent issues:

```bash
python3 .codex/skills/codex-issue-digest/scripts/collect_issue_digest.py --labels tui exec --window-hours 24
```

```bash
python3 .codex/skills/codex-issue-digest/scripts/collect_issue_digest.py --all-labels --window "past week" --limit-issues 10
```

Run the focused script tests:

```bash
pytest .codex/skills/codex-issue-digest/scripts/test_collect_issue_digest.py
```
