## Branch 11: feat/github-ref-plugins

- `PluginInput.skills` now has to bridge through `Skill.Service.use(...)` inside `packages/opencode/src/plugin/index.ts`; direct `Skill.all/get/dirs` calls are not valid on the rebased Effect service shape.
- `packages/opencode/test/skill/skill.test.ts` must keep the `it.live(...)`/`testEffect(...)` harness. Raw `test(...)` blocks from the branch need conversion to Effect tests to typecheck against the rebased helpers.
- The workspace needed `bun install` before verification; without local dependencies, `bun typecheck` could not find `tsgo` and Bun test preloads failed to resolve.
