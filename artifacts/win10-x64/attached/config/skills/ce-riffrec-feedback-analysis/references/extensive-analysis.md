# Extensive analysis path

Use this path when the input is a longer recording (over ~60 seconds), contains multiple issues, requirements, or workflow walkthroughs, or the user explicitly wants requirements material. The goal is a full Compound Engineering-compatible artifact set that feeds `ce-brainstorm`.

## Workflow

1. Run the analyzer:

   ```bash
   python scripts/analyze_riffrec_zip.py /path/to/input
   ```

   Use `--output-dir <dir>` when the artifact should live somewhere specific. In a repo with `docs/brainstorms/`, the default output goes under `docs/brainstorms/riffrec-feedback/`.

2. Read the generated `analysis.md`, `problem-analysis.md`, `review-prompt.md`, and `requirements-kickoff.md`.

3. Read `source-materials.md` before brainstorm. It is the source-of-truth manifest for the original raw feedback location, transcript, local-only frames, chunks, analysis artifacts, and screenshot paths. Use it to keep brainstorm and planning traceable to the original feedback evidence.

4. Inspect the extracted screenshots for high-signal moments using the platform's image-view tool. Prioritize screenshots selected because of click events near verbal complaints, failed network requests, console errors, or repeated interaction.

5. Fill or refine `problem-analysis.md` using the frame review structure from `review-prompt.md`. The final problem analysis must have exactly these top-level categories:

   - **Visual/UI Problems**
   - **Functional Problems**
   - **Requirements**
   - **Usability/UX Problems**

   Each numbered item should describe the problem, location, UI element, frame reference, and relevant transcript context when available. Focus on WHAT is wrong, not HOW to fix it.

6. Convert evidence into requirements. Keep these categories distinct:

   - **Observed facts:** transcript quotes, click targets, request statuses, screenshot contents.
   - **Inferences:** likely user intent, likely broken control, suspected missing state.
   - **Requirements:** product behavior needed to resolve the problem.

7. When the current workspace contains the product source code, run a source-mapping pass before or during brainstorm. Use the transcript language, visible UI labels, screenshot paths, route names, and generated requirements to search the codebase for likely components, controllers, services, models, tests, and state stores. For larger sessions, split this mapping by product area and use sub-agents when available so independent areas can be inspected in parallel.

8. Add source mapping to the brainstorm material as suspected implementation surfaces, not as proven root cause unless the code clearly proves it. Include confidence levels and short evidence notes explaining why each file or component is relevant.

9. Always continue into brainstorm. Once `analysis.md`, `problem-analysis.md`, `source-materials.md`, and `requirements-kickoff.md` exist, say "Analysis complete. Ready to brainstorm the findings." Then immediately load the `ce-brainstorm` skill with the generated `requirements-kickoff.md`, unless the user explicitly asked only to extract or analyze artifacts.

10. In brainstorm, first ask the user to confirm the captured requirements: "Did this capture the requirements correctly, and what is missing, wrong, or grouped badly?" Do not move to planning until brainstorm has confirmed or corrected the requirements.

## Automatic handoff

Do not end the workflow after extraction in normal use. The intended sequence is:

1. Run the analyzer.
2. Read `source-materials.md` so brainstorm has direct links to raw feedback, transcript, frames, and analysis artifacts.
3. Inspect or refine `problem-analysis.md` when the evidence needs human-visible interpretation.
4. Load the `ce-brainstorm` skill with `requirements-kickoff.md`.
5. Ask the user to confirm, correct, or regroup the captured requirements.
6. Let `ce-brainstorm` produce the durable requirements doc under `docs/brainstorms/`.

Only stop after step 1 or 2 when the user asks specifically for raw artifacts, transcript, screenshots, or analysis without brainstorming.

## Capture scale

Prefer over-capture to under-capture. The purpose of this path is to preserve product feedback as structured data for later AI work, not to decide what is worth implementing during extraction.

When analyzing a feedback source:

- Capture every distinct problem, bug, request, expectation, confusion point, and "note to self" that appears in the transcript or frames.
- Include concrete examples from the source material for each issue when possible: timestamp, transcript phrase, screenshot path, clicked UI element, email/thread ID, or observed state.
- Include concrete source-code mapping when possible: likely component/service/controller/model/test files, route or API endpoint names, relevant state variables, and confidence level. This mapping should make it obvious where a later implementation agent should start looking.
- If only video is available, infer likely screens and components from visible UI labels, layout, URLs, route names, copied text, screenshots, and transcript references. Mark uncertain mappings explicitly instead of omitting them.
- If only audio or notes are available, map from product terminology and workflow descriptions to likely code areas when the repo is present, and label the mapping as transcript-derived.
- Do not drop lower-priority items during analysis. Mark them as lower priority or secondary if needed, but keep them represented.
- Separate capture from prioritization. Brainstorm may regroup, split, defer, or reject items later, but the first requirements pass should preserve the full signal.
- If a feedback session contains many issues, create a comprehensive capture document and state that planning should split it into smaller plans.
- Treat source mapping as supporting material, not a filter. If a problem cannot yet be mapped to code, keep the problem and mark the source mapping as unknown.

## Source mapping grounding

When mapping feedback to source code, classify each mapping as one of:

- **Likely buggy surface:** the code path exists and directly handles the observed behavior.
- **Missing or incomplete surface:** the feedback names a behavior, but the repo has no clear UI, route, controller action, or component implementing it yet.
- **Indirect surface:** the code is adjacent to the behavior, but the exact interaction may happen through rendered email content, third-party UI, generated HTML, or another layer.
- **Unknown:** no grounded source mapping found yet.

Every source mapping should include:

- Requirement/example ids, such as `R14`, `AE4`, or `EX17`.
- File paths with line numbers when practical.
- A short evidence note from code, not just a file guess.
- Confidence: `High`, `Medium`, `Low`, or `Unknown`.

Prefer saying "I did not find a current inbox implementation for this surface" over forcing a speculative mapping. Missing surfaces are useful product findings and should stay in the brainstorm.

## Output shape

The analyzer writes:

- `analysis.md`: session summary, transcript, selected moments, screenshot links, candidate findings, and review checklist.
- `problem-analysis.md`: a categorized problem statement scaffold for visual, functional, requirement, and UX findings.
- `review-prompt.md`: a filled prompt containing screenshot paths and transcript for a deeper visual analysis pass.
- `source-materials.md`: a manifest linking the original source location, local-only raw files, transcript locations, chunks, local-only frames, and generated artifacts.
- `requirements-kickoff.md`: a CE-friendly requirements starter with Problem Frame, Actors, Key Flows, R-IDs, Acceptance Examples, Success Criteria, Scope Boundaries, Questions, and Next Steps.
- `analysis.json`: structured session, event, transcript, moment, and artifact metadata.
- `frames/`: extracted PNG screenshots for selected moments. Local-only by default.
- `raw/`: extracted zip contents and copied source media. Local-only by default.

Long media is transcribed in chunks when a single transcription request is too large. Chunk transcripts include timestamp prefixes so the review pass can still connect discussion points to approximate video regions.

For audio-only or notes-only sources, the visual sections intentionally say that no frames are available. In those cases, extract functional problems, requirements, and UX friction from transcript or notes only.

## Review heuristics

Select moments when they contain:

- Verbal complaint cues: "weird", "doesn't work", "can't", "broken", "bug", "problem", "confusing", "should".
- Clicks on controls shortly before or after a complaint.
- Repeated clicks on the same control.
- Failed requests outside known development noise.
- Console errors, uncaught exceptions, or failed form submissions.
- Visible toasts, validation errors, disabled controls, empty states, or surprising navigation.

The script's findings are deliberately conservative. Look at screenshots and transcript together before turning a candidate finding into a requirement.
