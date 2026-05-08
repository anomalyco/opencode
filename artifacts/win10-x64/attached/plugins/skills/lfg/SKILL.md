---
name: lfg
description: Full autonomous engineering workflow
argument-hint: "[feature description]"
disable-model-invocation: true
---

CRITICAL: You MUST execute every step below IN ORDER. Do NOT skip any required step. Do NOT jump ahead to coding or implementation. The plan phase (step 1) MUST be completed and verified BEFORE any work begins. Violating this order produces bad output.

When invoking any skill referenced below, resolve its name against the available-skills list the host platform provides and use that exact entry. Some platforms list skills under a plugin namespace (e.g., `ce-plan`); others list the bare name. Invoking a short-form guess that isn't in the list will fail — always match a listed entry verbatim before calling the Skill/Task tool.

1. Invoke the `ce-plan` skill with `$ARGUMENTS`.

   GATE: STOP. If ce-plan reported the task is non-software and cannot be processed in pipeline mode, stop the pipeline and inform the user that LFG requires software tasks. Otherwise, verify that the `ce-plan` workflow produced a plan file in `docs/plans/`. If no plan file was created, invoke `ce-plan` again with `$ARGUMENTS`. Do NOT proceed to step 2 until a written plan exists. **Record the plan file path** — it will be passed to ce-code-review in step 3.

2. Invoke the `ce-work` skill.

   GATE: STOP. Verify that implementation work was performed - files were created or modified beyond the plan. Do NOT proceed to step 3 if no code changes were made.

3. Invoke the `ce-code-review` skill with `mode:autofix plan:<plan-path-from-step-1>`.

   Pass the plan file path from step 1 so ce-code-review can verify requirements completeness. Read the Residual Actionable Work summary the skill emits.

4. **Persist review autofixes** (REQUIRED after step 3, before residual handoff)

   Check `git status --short`. If `ce-code-review mode:autofix` changed files, stage only those review-fix files, commit them with `fix(review): apply autofix feedback`, and push the current branch before continuing. If an upstream exists, run `git push`. If no upstream exists, resolve a writable remote dynamically: prefer `origin` when present, otherwise use `git remote` and choose the first configured remote. Then run `git push --set-upstream <remote> HEAD`. Do not proceed to step 5, run browser tests, or output DONE while review autofix edits remain only in the working tree. If no files changed, explicitly note that there were no review autofixes to persist.

5. **Autonomous residual handoff** (only when step 3 reported one or more residual `downstream-resolver` findings; skip when it reported `Residual actionable work: none.`)

   Do not prompt the user. This step embraces the autopilot contract: residuals must become durable before DONE, but the agent never stops to ask.

   1. Load `references/tracker-defer.md` in **non-interactive mode**. Pass the residual actionable findings from step 3's summary (or the run artifact when the summary was truncated).
   2. Collect the structured return: `{ filed: [...], failed: [...], no_sink: [...] }`.
   3. Compose a `## Residual Review Findings` markdown section from the structured return:
      - For each item in `filed`: a bullet with severity, file:line, title, and a link to the tracker ticket URL.
      - For each item in `failed`: a bullet with severity, file:line, title, and the failure reason (e.g., `Defer failed: gh returned 401 — tracker unavailable`).
      - For each item in `no_sink`: a bullet with severity, file:line, and title inlined verbatim so the PR body or fallback file is the durable record.
   4. Detect the current branch's open PR without prompting:

      ```bash
      gh pr view --json number,url,body,state
      ```

   5. If an open PR exists, update it directly with `gh`; do not load any confirmation-driven PR update skill. Append or replace the `## Residual Review Findings` section in the current PR body, write the new body to an OS temp file, then run:

      ```bash
      gh pr edit PR_NUMBER --body-file BODY_FILE
      ```

   6. If no open PR exists, create a tracked fallback file at `docs/residual-review-findings/<branch-or-head-sha>.md` containing the composed section and the source PR-review run context. Stage only that file, commit it with `docs(review): record residual review findings`, and push the current branch. If an upstream exists, run `git push`. If no upstream exists, resolve a writable remote dynamically: prefer `origin` when present, otherwise use `git remote` and choose the first configured remote. Then run `git push --set-upstream <remote> HEAD`. This is the durable no-PR sink. Do not output DONE until either the existing PR body has been updated or this fallback file commit has been pushed. If both paths fail, stop and report the failed commands; do not silently proceed.

   Never block DONE on tracker filing failures once residuals have been durably recorded. A `no_sink` outcome is success only when the findings are present in the PR body or in the pushed fallback file.

6. Invoke the `ce-test-browser` skill with `mode:pipeline`.

7. Invoke the `ce-commit-push-pr` skill.

   This commits any remaining changes, pushes the branch, and opens a pull request. If step 5 already opened a PR (check with `gh pr view --json number,url,state 2>/dev/null`), skip PR creation but still commit and push any uncommitted changes.

8. Output `<promise>DONE</promise>` when complete

Start with step 1 now. Remember: plan FIRST, then work. Never skip the plan.
