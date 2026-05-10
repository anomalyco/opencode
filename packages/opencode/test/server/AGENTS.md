# Server Test Guide

Use these patterns for server and HttpApi middleware tests in this directory.

- Prefer focused middleware tests with tiny fake routes over full API route trees when testing routing, context, proxying, or middleware policy.
- Use `testEffect(...)` with `NodeHttpServer.layerTest` for the primary in-test server and make relative `HttpClient` requests against it.
- Use `HttpRouter.add(...)` probe routes that expose the context under test, such as `WorkspaceRouteContext`, `InstanceRef`, or `WorkspaceRef`.
- Compose middleware in the same order as production when testing interactions, for example `instanceRouterMiddleware.combine(workspaceRouterMiddleware)`.
- For secondary upstream servers, build Effect `NodeHttpServer.layer(...)` into the current test scope with `Layer.build(...)` so the listener stays alive until the test scope exits.
- Avoid `Bun.serve` when testing Effect HTTP middleware. Keep the test in the Effect HTTP stack unless the production path being tested is Bun-specific.
- For WebSocket paths, use `Socket.makeWebSocket(...)` from the test client and assert protocol forwarding or frame relay when relevant.
- Use scoped test layers for flags, database reset, and other global mutable state. Restore flags and reset state in finalizers.
- Use `tmpdirScoped({ git: true })` plus `Project.use.fromDirectory(dir)` for project-backed requests.
- If a test needs persisted state without matching runtime state, keep direct database setup inside a narrowly named helper that explains that state.
- Add comments for non-obvious test topology, especially tests involving both the local test server and a fake upstream server.
