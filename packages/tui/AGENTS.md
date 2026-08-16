# TUI UI Experiments

- Before implementing a visual behavior as an experiment, add a fixture-driven story under `src/feature-plugins/system/storybook` that renders the real production component.
- Put the current treatment and meaningfully different variants in the story. Expose replay and tuning controls in `StoryFooter`, including reset when values are adjustable.
- Let the user choose or tune a variant in the story before selecting production defaults.
- After selection, register the behavior in `src/component/dialog-experiments.tsx` and gate it with `config.data.experimental?.<id> === true`; experiments must not change default behavior.
- Treat tuning-only stories as local scaffolding and remove them and their registration before committing. Commit a story only when the user explicitly wants it retained as a reusable regression fixture.
- Use OpenCode Drive with a simulated LLM for deterministic turn/session behavior. Do not invoke a real model only to verify TUI behavior.
- Run the story with `OPENCODE_STORY=<story-id> bun run dev:live` and exercise relevant wide and narrow terminal sizes.
