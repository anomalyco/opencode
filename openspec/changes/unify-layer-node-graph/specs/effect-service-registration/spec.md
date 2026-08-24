## ADDED Requirements

### Requirement: single source of truth for service DI registration

Every service SHALL be reachable from both Effect dependency graphs: the
legacy `AppLayer` / `BootstrapLayer` / `defaultLayer` composition, and the
`LayerNode` graph that builds the real HTTP API server
(`server/routes/instance/httpapi/server.ts`). No service may be correctly
wired into one graph while silently absent from the other. The two graphs are
typechecked independently today, so a mismatch is
invisible to `bun run typecheck` and only surfaces as a runtime
`Service not found` crash (service registered in `AppLayer`/`defaultLayer` but
missing from the `LayerNode` graph — the `AutoMode` and `PatternDetection`
incidents) or as silently inert code (service never registered in either
graph's active path — the `auto-reply`/`automation-features`/
`pattern-detection`/`scheduler` case documented in `retire-auto-reply`).

#### Scenario: a service added to AppLayer is exercised through the real server

- **WHEN** a service's `defaultLayer` is added to `AppLayer` and the service is
  called from code reachable via the HTTP API (e.g. session prompt handling)
- **THEN** that service also has a `LayerNode` `.node` registered in
  `server/routes/instance/httpapi/server.ts`'s node list, so a real
  `opencode run` / TUI prompt does not crash with `Service not found`

#### Scenario: a missing registration is caught before merge, not at runtime

- **WHEN** a service exports `defaultLayer` but its `.node` is missing or not
  registered in `server.ts`, or a `.node` exists but nothing outside the HTTP
  server path can reach an equivalent registration
- **THEN** a build-time check (compile-time `LayerNode` dependency error, or an
  explicit regression-guard script) fails, rather than the gap surfacing only
  when a user sends a prompt

#### Scenario: hand-rolled provide chains do not silently lose type safety

- **WHEN** a `.pipe(Layer.provide(...), ...)` composition (e.g.
  `SessionPrompt.defaultLayer`) needs a new dependency added
- **THEN** adding it either produces a clear compile error if a dependency is
  still missing, or succeeds without the chain having silently exceeded
  TypeScript's `pipe()` overload arity ceiling and degraded its inferred type
  to `unknown`
