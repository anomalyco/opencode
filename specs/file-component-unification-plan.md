# File Component Unification Plan

Single path for text, diff, and media

---

## Define goal

Introduce one public UI component API that renders plain text files or diffs from the same entry point, so selection, comments, search, theming, and media behavior are maintained once.

### Goal

- Add a unified `File` component in `packages/ui/src/components/file.tsx` that chooses plain or diff rendering from props.
- Centralize shared behavior now split between `packages/ui/src/components/code.tsx` and `packages/ui/src/components/diff.tsx`.
- Bring the existing find/search UX to diff rendering through a shared engine.
- Consolidate media rendering logic currently split across `packages/ui/src/components/session-review.tsx` and `packages/app/src/pages/session/file-tabs.tsx`.
- Provide a clear SSR path for preloaded diffs without keeping a third independent implementation.

### Non-goal

- Do not change `@pierre/diffs` behavior or fork its internals.
- Do not redesign line comment UX, diff visuals, or keyboard shortcuts.
- Do not remove legacy `Code`/`Diff` APIs in the first pass.
- Do not add new media types beyond parity unless explicitly approved.
- Do not refactor unrelated session review or file tab layout code outside integration points.

---

## Audit duplication

The current split duplicates runtime logic and makes feature parity drift likely.

### Duplicate categories

- Rendering lifecycle is duplicated in `code.tsx` and `diff.tsx`, including instance creation, cleanup, `onRendered` readiness, and shadow root lookup.
- Theme sync is duplicated in `code.tsx`, `diff.tsx`, and `diff-ssr.tsx` through similar `applyScheme` and `MutationObserver` code.
- Line selection wiring is duplicated in `code.tsx` and `diff.tsx`, including drag state, shadow selection reads, and line-number bridge integration.
- Comment annotation rerender flow is duplicated in `code.tsx`, `diff.tsx`, and `diff-ssr.tsx`.
- Commented line marking is split across `markCommentedFileLines` and `markCommentedDiffLines`, with similar timing and effect wiring.
- Diff selection normalization (`fixSelection`) exists twice in `diff.tsx` and `diff-ssr.tsx`.
- Search exists only in `code.tsx`, so diff lacks find and the feature cannot be maintained in one place.
- Contexts are split (`context/code.tsx`, `context/diff.tsx`), which forces consumers to choose paths early.
- Media rendering is duplicated outside the core viewers in `session-review.tsx` and `file-tabs.tsx`.

### Drift pain points

- Any change to comments, theming, or selection requires touching multiple files.
- Diff SSR and client diff can drift because they carry separate normalization and marking code.
- Search cannot be added to diff cleanly without more duplication unless the viewer runtime is unified.

---

## Design architecture

Use one public component with a discriminated prop shape and split shared behavior into small runtime modules.

### Public API proposal

- Add `packages/ui/src/components/file.tsx` as the primary client entry point.
- Export a single `File` component that accepts a discriminated union with two primary modes.
- Use an explicit `mode` prop (`"text"` or `"diff"`) to avoid ambiguous prop inference and keep type errors clear.

### Proposed prop shape

- Shared props:
  - `annotations`
  - `selectedLines`
  - `commentedLines`
  - `onLineSelected`
  - `onLineSelectionEnd`
  - `onLineNumberSelectionEnd`
  - `onRendered`
  - `class`
  - `classList`
  - selection and hover flags already supported by current viewers
- Text mode props:
  - `mode: "text"`
  - `file` (`FileContents`)
  - text renderer options from `@pierre/diffs` `FileOptions`
- Diff mode props:
  - `mode: "diff"`
  - `before`
  - `after`
  - `diffStyle`
  - diff renderer options from `FileDiffOptions`
  - optional `preloadedDiff` only for SSR-aware entry or hydration adapter
- Media props (shared, optional):
  - `media` config for `"auto" | "off"` behavior
  - path/name metadata
  - optional lazy loader (`readFile`) for session review use
  - optional custom placeholders for binary or removed content

### Internal module split

- `packages/ui/src/components/file.tsx`
  Public unified component and mode routing.
- `packages/ui/src/components/file-ssr.tsx`
  Unified SSR entry for preloaded diff hydration.
- `packages/ui/src/components/file-search.tsx`
  Shared find bar UI and host registration.
- `packages/ui/src/components/file-media.tsx`
  Shared image/audio/svg/binary rendering shell.
- `packages/ui/src/pierre/file-runtime.ts`
  Common render lifecycle, instance setup, cleanup, scheme sync, and readiness notification.
- `packages/ui/src/pierre/file-selection.ts`
  Shared selection/drag/line-number bridge controller with mode adapters.
- `packages/ui/src/pierre/diff-selection.ts`
  Diff-specific `fixSelection` and row/side normalization reused by client and SSR.
- `packages/ui/src/pierre/file-find.ts`
  Shared find engine (scan, highlight API, overlay fallback, match navigation).
- `packages/ui/src/pierre/media.ts`
  MIME normalization, data URL helpers, and media type detection.

### Wrapper strategy

- Keep `packages/ui/src/components/code.tsx` as a thin compatibility wrapper over unified `File` in text mode.
- Keep `packages/ui/src/components/diff.tsx` as a thin compatibility wrapper over unified `File` in diff mode.
- Keep `packages/ui/src/components/diff-ssr.tsx` as a thin compatibility wrapper over unified SSR entry.

---

## Phase delivery

Ship this in small phases so each step is reviewable and reversible.

### Phase 0: Align interfaces

- Document the final prop contract and adapter behavior before moving logic.
- Add a short migration note in the plan PR description so reviewers know wrappers stay in place.

#### Acceptance

- Final prop names and mode shape are agreed up front.
- No runtime code changes land yet.

### Phase 1: Extract shared runtime pieces

- Move duplicated theme sync and render readiness logic from `code.tsx` and `diff.tsx` into shared runtime helpers.
- Move diff selection normalization (`fixSelection` and helpers) out of both `diff.tsx` and `diff-ssr.tsx` into `packages/ui/src/pierre/diff-selection.ts`.
- Extract shared selection controller flow into `packages/ui/src/pierre/file-selection.ts` with mode callbacks for line parsing and normalization.
- Keep `code.tsx`, `diff.tsx`, and `diff-ssr.tsx` behavior unchanged from the outside.

#### Acceptance

- `code.tsx`, `diff.tsx`, and `diff-ssr.tsx` are smaller and call shared helpers.
- Line selection, comments, and theme sync still work in current consumers.
- No consumer imports change yet.

### Phase 2: Introduce unified client entry

- Create `packages/ui/src/components/file.tsx` and wire it to shared runtime pieces.
- Route text mode to `@pierre/diffs` `File` or `VirtualizedFile` and diff mode to `FileDiff` or `VirtualizedFileDiff`.
- Preserve current performance rules, including virtualization thresholds and large-diff options.
- Keep search out of this phase if it risks scope creep, but leave extension points in place.

#### Acceptance

- New unified component renders text and diff with parity to existing components.
- `code.tsx` and `diff.tsx` can be rewritten as thin adapters without behavior changes.
- Existing consumers still work through old `Code` and `Diff` exports.

### Phase 3: Add unified context path

- Add `packages/ui/src/context/file.tsx` with `FileComponentProvider` and `useFileComponent`.
- Update `packages/ui/src/context/index.ts` to export the new context.
- Keep `context/code.tsx` and `context/diff.tsx` as compatibility shims that adapt to `useFileComponent`.
- Migrate `packages/app/src/app.tsx` and `packages/enterprise/src/routes/share/[shareID].tsx` to provide the unified component once wrappers are stable.

#### Acceptance

- New consumers can use one context path.
- Existing `useCodeComponent` and `useDiffComponent` hooks still resolve and render correctly.
- Provider wiring in app and enterprise stays compatible during transition.

### Phase 4: Share find and enable diff search

- Extract the find engine and find bar UI from `code.tsx` into shared modules.
- Hook the shared find host into unified `File` for both text and diff modes.
- Keep current shortcuts (`Ctrl/Cmd+F`, `Ctrl/Cmd+G`, `Shift+Ctrl/Cmd+G`) and active-host behavior.
- Preserve CSS Highlight API support with overlay fallback.

#### Acceptance

- Text mode search behaves the same as today.
- Diff mode now supports the same find UI and shortcuts.
- Multiple viewer instances still route shortcuts to the focused/active host correctly.

### Phase 5: Consolidate media rendering

- Extract media type detection and data URL helpers from `session-review.tsx` and `file-tabs.tsx` into shared UI helpers.
- Add `file-media.tsx` and let unified `File` optionally render media or binary placeholders before falling back to text/diff.
- Migrate `session-review.tsx` and `file-tabs.tsx` to pass media props instead of owning media-specific branches.
- Keep session-specific layout and i18n strings in the consumer where they are not generic.

#### Acceptance

- Image/audio/svg/binary handling no longer duplicates core detection and load state logic.
- Session review and file tabs still render the same media states and placeholders.
- Text/diff comment and selection behavior is unchanged when media is not shown.

### Phase 6: Align SSR and preloaded diffs

- Create `packages/ui/src/components/file-ssr.tsx` with the same unified prop shape plus `preloadedDiff`.
- Reuse shared diff normalization, theme sync, and commented-line marking helpers.
- Convert `packages/ui/src/components/diff-ssr.tsx` into a thin adapter that forwards to the unified SSR entry in diff mode.
- Migrate enterprise share page imports to `@opencode-ai/ui/file-ssr` when convenient, but keep `diff-ssr` export working.

#### Acceptance

- Preloaded diff hydration still works in `packages/enterprise/src/routes/share/[shareID].tsx`.
- SSR diff and client diff now share normalization and comment marking helpers.
- No duplicate `fixSelection` implementation remains.

### Phase 7: Clean up and document

- Remove dead internal helpers left behind in `code.tsx` and `diff.tsx`.
- Add a short migration doc for downstream consumers that want to switch from `Code`/`Diff` to unified `File`.
- Mark `Code`/`Diff` contexts and components as compatibility APIs in comments or docs.

#### Acceptance

- No stale duplicate helpers remain in legacy wrappers.
- Unified path is the default recommendation for new UI work.

---

## Preserve compatibility

Keep old APIs working while moving internals under them.

### Context migration strategy

- Introduce `FileComponentProvider` without deleting `CodeComponentProvider` or `DiffComponentProvider`.
- Implement `useCodeComponent` and `useDiffComponent` as adapters around the unified context where possible.
- If full adapter reuse is messy at first, keep old contexts and providers as thin wrappers that internally provide mapped unified props.

### Consumer migration targets

- `packages/app/src/pages/session/file-tabs.tsx` should move from `useCodeComponent` to `useFileComponent`.
- `packages/ui/src/components/session-review.tsx`, `session-turn.tsx`, and `message-part.tsx` should move from `useDiffComponent` to `useFileComponent`.
- `packages/app/src/app.tsx` and `packages/enterprise/src/routes/share/[shareID].tsx` should eventually provide only the unified provider.
- Keep legacy hooks available until all call sites are migrated and reviewed.

### Compatibility checkpoints

- `@opencode-ai/ui/code`, `@opencode-ai/ui/diff`, and `@opencode-ai/ui/diff-ssr` imports must keep working during migration.
- Existing prop names on `Code` and `Diff` wrappers should remain stable to avoid broad app changes in one PR.

---

## Unify search

Port the current find feature into a shared engine and attach it to both modes.

### Shared engine plan

- Move keyboard host registry and active-target logic out of `code.tsx` into `packages/ui/src/pierre/file-find.ts`.
- Move the find bar UI into `packages/ui/src/components/file-search.tsx`.
- Keep DOM-based scanning and highlight/overlay rendering shared, since both text and diff render into the same shadow-root patterns.

### Diff-specific handling

- Search should scan both unified and split diff columns through the same selectors used in the current code find feature.
- Match navigation should scroll the active range into view without interfering with line selection state.
- Search refresh should run after `onRendered`, diff style changes, annotation rerenders, and query changes.

### Scope guard

- Preserve the current DOM-scan behavior first, even if virtualized search is limited to mounted rows.
- If full-document virtualized search is required, treat it as a follow-up with a text-index layer rather than blocking the core refactor.

---

## Consolidate media

Move media rendering logic into shared UI so text, diff, and media routing live behind one entry.

### Ownership plan

- Put media detection and normalization helpers in `packages/ui/src/pierre/media.ts`.
- Put shared rendering UI in `packages/ui/src/components/file-media.tsx`.
- Keep layout-specific wrappers in `session-review.tsx` and `file-tabs.tsx`, but remove duplicated media branching and load-state code from them.

### Proposed media props

- `media.mode`: `"auto"` or `"off"` for default behavior.
- `media.path`: file path for extension checks and labels.
- `media.current`: loaded file content for plain-file views.
- `media.before` and `media.after`: diff-side values for image/audio previews.
- `media.readFile`: optional lazy loader for session review expansion.
- `media.renderBinaryPlaceholder`: optional consumer override for binary states.
- `media.renderLoading` and `media.renderError`: optional consumer overrides when generic text is not enough.

### Parity targets

- Keep current image and audio support from session review.
- Keep current SVG and binary handling from file tabs.
- Defer video or PDF support unless explicitly requested.

---

## Align SSR

Make SSR diff hydration a mode of the unified viewer instead of a parallel implementation.

### SSR plan

- Add `packages/ui/src/components/file-ssr.tsx` as the unified SSR entry with a diff-only path in phase one.
- Reuse shared diff helpers for `fixSelection`, theme sync, and commented-line marking.
- Keep the private `fileContainer` hydration workaround isolated in the SSR module so client code stays clean.

### Integration plan

- Keep `packages/ui/src/components/diff-ssr.tsx` as a forwarding adapter for compatibility.
- Update enterprise share route to the unified SSR import after client and context migrations are stable.
- Align prop names with the client `File` component so `SessionReview` can swap client/SSR providers without branching logic.

### Defer item

- Plain-file SSR hydration is not needed for this refactor and can stay out of scope.

---

## Verify behavior

Use typechecks and targeted UI checks after each phase, and avoid repo-root runs.

### Typecheck plan

- Run `bun run typecheck` from `packages/ui` after phases 1-7 changes there.
- Run `bun run typecheck` from `packages/app` after migrating file tabs or app provider wiring.
- Run `bun run typecheck` from `packages/enterprise` after SSR/provider changes on the share route.

### Targeted UI checks

- Text mode:
  - small file render
  - virtualized large file render
  - drag selection and line-number selection
  - comment annotations and commented-line marks
  - find shortcuts and match navigation
- Diff mode:
  - unified and split styles
  - large diff fallback options
  - diff selection normalization across sides
  - comments and commented-line marks
  - new find UX parity
- Media:
  - image, audio, SVG, and binary states in file tabs
  - image and audio diff previews in session review
  - lazy load and error placeholders
- SSR:
  - enterprise share page preloaded diffs hydrate correctly
  - theme switching still updates hydrated diffs

### Regression focus

- Watch scroll restore behavior in `packages/app/src/pages/session/file-tabs.tsx`.
- Watch multi-instance find shortcut routing in screens with many viewers.
- Watch cleanup paths for listeners and virtualizers to avoid leaks.

---

## Manage risk

Keep wrappers and adapters in place until the unified path is proven.

### Key risks

- Selection regressions are the highest risk because text and diff have similar but not identical line semantics.
- SSR hydration can break subtly if client and SSR prop shapes drift.
- Shared find host state can misroute shortcuts when many viewers are mounted.
- Media consolidation can accidentally change placeholder timing or load behavior.

### Rollback strategy

- Land each phase in separate PRs or clearly separated commits on `dev`.
- If a phase regresses behavior, revert only that phase and keep earlier extractions.
- Keep `code.tsx`, `diff.tsx`, and `diff-ssr.tsx` wrappers intact until final verification, so a rollback only changes internals.
- If diff search is unstable, disable it behind the unified component while keeping the rest of the refactor.

---

## Order implementation

Follow this sequence to keep reviews small and reduce merge risk.

1. Finalize prop shape and file names for the unified component and context.
2. Extract shared diff normalization, theme sync, and render-ready helpers with no public API changes.
3. Extract shared selection controller and migrate `code.tsx` and `diff.tsx` to it.
4. Add the unified client `File` component and convert `code.tsx`/`diff.tsx` into wrappers.
5. Add `FileComponentProvider` and migrate provider wiring in `app.tsx` and enterprise share route.
6. Migrate consumer hooks (`file-tabs`, `session-review`, `message-part`, `session-turn`) to the unified context.
7. Extract and share find engine/UI, then enable search in diff mode.
8. Extract media helpers/UI and migrate `session-review.tsx` and `file-tabs.tsx`.
9. Add unified `file-ssr.tsx`, convert `diff-ssr.tsx` to a wrapper, and migrate enterprise imports.
10. Remove dead duplication and write a short migration note for future consumers.

---

## Decide open items

Resolve these before coding to avoid rework mid-refactor.

### API decisions

- Should the unified component require `mode`, or should it infer mode from props for convenience.
- Should the public export be named `File` only, or also ship a temporary alias like `UnifiedFile` for migration clarity.
- Should `preloadedDiff` live on the main `File` props or only on `file-ssr.tsx`.

### Search decisions

- Is DOM-only search acceptable for virtualized content in the first pass.
- Should find state reset on every rerender, or preserve query and index across diff style toggles.

### Media decisions

- Which placeholders and strings should stay consumer-owned versus shared in UI.
- Whether SVG should be treated as media-only, text-only, or a mixed mode with both preview and source.
- Whether video support should be included now or explicitly deferred.

### Migration decisions

- How long `CodeComponentProvider` and `DiffComponentProvider` should remain supported.
- Whether to migrate all consumers in one PR after wrappers land, or in follow-up PRs by surface area.
- Whether `diff-ssr` should remain as a permanent alias for compatibility.
