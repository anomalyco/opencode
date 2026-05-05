# Proposal: Patch Pipeline

## Summary

Patch behaviour is currently split between the generic patch primitives in `src/patch.ts` and the request compilation flow in `src/adapter.ts`. This proposal introduces a patch pipeline module that owns the patch lifecycle in one place.

The pipeline is created once by `LLMClient.make(...)` with the client patch set. Each request then flows through that same pipeline instance. Adapter-local target patches are still supplied per selected Adapter because they vary by route.

The goal is to make patch ordering, context refresh, route invariants, tool-schema handling, target patching, stream patching, and trace assembly one deep module instead of implicit knowledge inside `LLMClient.compile(...)`.

## Current Shape

Patch definitions are small values:

```ts
// src/patch.ts
export interface Patch<A> {
  readonly id: string
  readonly phase: PatchPhase
  readonly reason: string
  readonly order?: number
  readonly when: (context: PatchContext) => boolean
  readonly apply: (value: A, context: PatchContext) => A
}
```

`Patch.plan(...)` handles one phase:

```ts
export function plan<A>(input: {
  readonly phase: PatchPhase
  readonly context: PatchContext
  readonly patches: ReadonlyArray<Patch<A>>
}): PatchPlan<A> {
  const patches = input.patches
    .filter((patch) => patch.phase === input.phase && patch.when(input.context))
    .toSorted((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id))

  return {
    phase: input.phase,
    patches,
    trace: patches.map((patch) => new PatchTrace({ id: patch.id, phase: patch.phase, reason: patch.reason })),
    apply: (value) => patches.reduce((next, patch) => patch.apply(next, input.context), value),
  }
}
```

The lifecycle is embedded in `LLMClient.compile(...)`:

```ts
const requestPlan = plan({ phase: "request", context: context({ request }), patches: registry.request })
const requestAfterRequestPatches = requestPlan.apply(request)
yield* ensureSameRoute(request.model, requestAfterRequestPatches.model)

const promptPlan = plan({ phase: "prompt", context: context({ request: requestAfterRequestPatches }), patches: registry.prompt })
const requestBeforeToolPatches = promptPlan.apply(requestAfterRequestPatches)
yield* ensureSameRoute(request.model, requestBeforeToolPatches.model)

const toolSchemaPlan = plan({ phase: "tool-schema", context: context({ request: requestBeforeToolPatches }), patches: registry.toolSchema })
const patchedRequest = requestBeforeToolPatches.tools.length === 0 || toolSchemaPlan.patches.length === 0
  ? requestBeforeToolPatches
  : new LLMRequest({ ...requestBeforeToolPatches, tools: requestBeforeToolPatches.tools.map(toolSchemaPlan.apply) })

const candidate = yield* adapter.prepare(patchedRequest)
const targetPlan = plan({ phase: "target", context: context({ request: patchedRequest }), patches: [...adapter.patches, ...registry.target] })
const target = yield* adapter.validate(targetPlan.apply(candidate))
const patchTrace = [...requestPlan.trace, ...promptPlan.trace, ...toolSchemaPlan.trace, ...targetPlan.trace]
```

Stream patches are another single-phase plan later in `stream(...)`:

```ts
const streamPlan = plan({ phase: "stream", context: context({ request: compiled.request }), patches: registry.stream })
const events = compiled.adapter.parse(response, { request: compiled.request, patchTrace: compiled.patchTrace })
return streamPlan.patches.length === 0 ? events : events.pipe(Stream.map(streamPlan.apply))
```

## Current Patch Phase Usage

The runtime supports five phases today:

- `request`
- `prompt`
- `tool-schema`
- `target`
- `stream`

Built-in default provider policy currently uses only `prompt` through `ProviderPatch.defaults`.

Built-in provider modules use `target` for opt-in adapter-local patches such as `OpenAIChat.includeUsage` and `OpenAICompatibleChat.includeUsage`.

`request`, `tool-schema`, and `stream` are real runtime seams, but today they are used by tests and consumers rather than by default package policy.

That is still enough to justify one lifecycle module. The runtime already has all five seams; the problem is that their ordering and interactions are owned by `LLMClient` instead of by a patch pipeline.

## Problem

`Patch.plan(...)` is shallow. Its Interface is almost as complex as its Implementation: callers still choose the phase, build the context, remember ordering semantics, apply the plan, stitch traces, and decide when the context must be refreshed.

The deep behaviour is not in the patch module. It is spread across `LLMClient.compile(...)`:

- Adapter selection happens against the original request before request-shaped patches run.
- Request patches must run before prompt patches.
- Prompt patches must see the request after request patches.
- Request and prompt patches must not reroute `model.provider`, `model.id`, or `model.protocol`.
- Tool-schema patches apply to every tool definition, but only when tools exist and patches matched.
- Tool-schema trace appears once per matched patch, not once per tool.
- Target patches run after Adapter lowering because they speak provider-native target shape.
- Adapter-local target patches and client registry target patches are combined, then ordered by patch `order` and `id`.
- Adapter validation runs after target patches, but validation logic remains owned by the Adapter.
- Trace order must match lifecycle order.
- Stream patches run after Adapter parsing, but use the compiled request as context.

This hurts locality. A bug in patch ordering or context refresh requires reading `src/patch.ts`, `src/adapter.ts`, provider patches, and tests. The rules are not discoverable from the patch Interface.

The deletion test shows the problem. Deleting `Patch.plan(...)` would not remove much complexity; callers could inline the filter/sort/reduce. Deleting the lifecycle code in `LLMClient.compile(...)` would make the complexity reappear anywhere requests need to be compiled correctly. That lifecycle is the module earning its keep, but it does not have its own seam.

## Proposed Shape

Introduce a patch pipeline module that closes over the client patch set once:

```ts
const pipeline = PatchPipeline.make(options.patches)
```

`PatchPipeline.make(...)` accepts the same patch inputs `LLMClient` accepts today:

```ts
PatchPipeline.make(options.patches)
PatchPipeline.make(ProviderPatch.defaults)
PatchPipeline.make(Patch.registry([...]))
```

The pipeline instance is immutable and reused for each request handled by that `LLMClient`.

```ts
export interface PatchPipeline {
  readonly patchRequest: (request: LLMRequest) => Effect.Effect<PatchedRequest, LLMError>
  readonly patchTarget: <Target>(input: PatchTargetInput<Target>) => Effect.Effect<PatchedTarget<Target>, LLMError>
  readonly patchStreamEvents: (input: PatchStreamInput) => Stream.Stream<LLMEvent, LLMError>
}
```

The names should stay patch-focused. Avoid `prepareRequest` and `prepareTarget` because `LLMClient.prepare`, `Adapter.prepare`, and Protocol lowering already use prepare terminology.

One possible state shape:

```ts
export interface PatchedRequest {
  readonly original: LLMRequest
  readonly request: LLMRequest
  readonly trace: ReadonlyArray<PatchTrace>
}

export interface PatchTargetInput<Target> {
  readonly state: PatchedRequest
  readonly target: Target
  readonly adapterPatches: ReadonlyArray<Patch<Target>>
  readonly validateTarget: (target: Target) => Effect.Effect<Target, LLMError>
}

export interface PatchedTarget<Target> {
  readonly request: LLMRequest
  readonly target: Target
  readonly trace: ReadonlyArray<PatchTrace>
}
```

Then `LLMClient.compile(...)` becomes routing plus Adapter orchestration:

```ts
const pipeline = PatchPipeline.make(options.patches)

const compile = Effect.fn("LLM.compile")(function* (request: LLMRequest) {
  const adapter = adapters.get(request.model.protocol) ?? modelAdapters.get(request.model)
  if (!adapter) return yield* noAdapter(request.model)

  const patchedRequest = yield* pipeline.patchRequest(request)
  const candidate = yield* adapter.prepare(patchedRequest.request)
  const patchedTarget = yield* pipeline.patchTarget({
    state: patchedRequest,
    target: candidate,
    adapterPatches: adapter.patches,
    validateTarget: adapter.validate,
  })

  const http = yield* adapter.toHttp(patchedTarget.target, {
    request: patchedTarget.request,
    patchTrace: patchedTarget.trace,
  })

  return {
    request: patchedTarget.request,
    adapter,
    target: patchedTarget.target,
    http,
    patchTrace: patchedTarget.trace,
  }
})
```

Stream patching also moves behind the same module, but only after Adapter parsing:

```ts
const events = compiled.adapter.parse(response, {
  request: compiled.request,
  patchTrace: compiled.patchTrace,
})

return pipeline.patchStreamEvents({
  request: compiled.request,
  events,
})
```

This is the important cleanup: `LLMClient` no longer hand-assembles phase plans, context refresh, route protection, target patch ordering, validation timing, stream patch mapping, or patch trace concatenation.

## Performance And Simplicity

This design should be at least as performant as the current shape, and likely a little better, because patches generally live at client construction time rather than changing per request.

Today, every request rebuilds phase plans:

```ts
plan({ phase: "request", context, patches: registry.request })
plan({ phase: "prompt", context, patches: registry.prompt })
plan({ phase: "tool-schema", context, patches: registry.toolSchema })
plan({ phase: "target", context, patches: [...adapter.patches, ...registry.target] })
```

Each plan filters and sorts its phase patches. That cost is tiny compared with an LLM request, but it is still repeated work and repeated code.

The patch pipeline can precompile the client-level patch set once:

```ts
const pipeline = PatchPipeline.make(options.patches)
```

At construction time, the pipeline can:

- Normalize `undefined`, a patch array, or a `PatchRegistry` into one internal shape.
- Group patches by phase.
- Sort each client-level phase by `order` and `id` once.
- Store empty-phase fast paths so requests with no patches avoid allocation-heavy plan construction.

Per request, the pipeline still must evaluate `when(context)` predicates because predicates depend on the current request, model, protocol, metadata, tools, and provider. That part cannot be safely precompiled away unless a future patch type declares itself unconditional.

Target patches are slightly different because adapter-local target patches vary by selected Adapter. Keep the first version simple:

```ts
pipeline.patchTarget({
  state,
  target,
  adapterPatches: adapter.patches,
  validateTarget: adapter.validate,
})
```

The pipeline can combine already-sorted client target patches with adapter patches and apply the same ordering rule. If target patch counts ever become large, the pipeline can cache the sorted merged target patch list in a `WeakMap` keyed by the Adapter or by the adapter patch array. That is an internal Implementation optimization; the Interface does not need to expose it.

The important simplicity win is bigger than the micro-performance win. `LLMClient` would stop describing the patch algorithm in five places. The pipeline becomes a reusable compiled patch lifecycle: one small Interface, one place to optimize, one place to test.

## What The Module Owns

The patch pipeline module should own:

- Normalizing `PatchRegistry | ReadonlyArray<AnyPatch> | undefined` into a registry.
- Building fresh `PatchContext` after each request-shaped phase.
- Running request patches before prompt patches.
- Enforcing that request-shaped patches do not change `model.provider`, `model.id`, or `model.protocol`.
- Running tool-schema patches against every tool definition only when tools exist and patches matched.
- Emitting tool-schema trace once per matched patch, not once per tool.
- Combining request, prompt, tool-schema, and target traces in lifecycle order.
- Combining adapter-local target patches with client registry target patches and applying the shared patch ordering rule.
- Invoking Adapter target validation after target patches.
- Applying stream patches to parsed `LLMEvent` streams with the compiled request context.

It should not own:

- Adapter lookup.
- Protocol lowering via `adapter.prepare(...)`.
- Target validation Implementation.
- HTTP request construction.
- Provider-specific patch definitions.
- Provider stream parsing.

Those remain behind the Adapter, Protocol, Endpoint, Auth, Framing, ProviderPatch, and RequestExecutor modules.

## How This Cleans Up Code Elsewhere

`src/adapter.ts` gets smaller and more navigable:

- `normalizeRegistry(...)` moves out.
- `ensureSameRoute(...)` moves out.
- `compile(...)` stops constructing four separate plans.
- `compile(...)` stops manually refreshing contexts.
- `compile(...)` stops manually deciding when tool-schema traces count.
- `compile(...)` stops manually concatenating patch traces.
- `stream(...)` stops manually planning stream patches.

`src/patch.ts` becomes clearer:

- Patch constructors and predicates remain the primitive Interface.
- `plan(...)` can stay as an internal or low-level single-phase helper.
- Lifecycle semantics move to `src/patch-pipeline.ts` instead of being implied by Adapter tests.

Provider patch modules stay focused:

- `ProviderPatch.defaults` remains a list of provider facts.
- Provider-specific patches do not need to know lifecycle ordering.
- Adapter-local target patches keep living on the selected Adapter.

Tests get better locality:

- Patch primitive tests stay in `patch.test.ts`.
- Patch lifecycle tests move to `patch-pipeline.test.ts`.
- Adapter tests keep only Adapter responsibilities and one end-to-end smoke test that `LLMClient` invokes the pipeline.

## Why This Is Deepening

The patch pipeline would be a deeper module because a small Interface hides a larger amount of behaviour.

Current Interface:

```ts
plan({ phase, context, patches }).apply(value)
```

That Interface is shallow because the caller must know the lifecycle.

Proposed Interface:

```ts
const pipeline = PatchPipeline.make(options.patches)
const request = yield* pipeline.patchRequest(input)
const target = yield* pipeline.patchTarget({ state: request, target, adapterPatches, validateTarget })
const events = pipeline.patchStreamEvents({ request: target.request, events })
```

That Interface is deeper because callers get ordering, context refresh, route protection, tool-schema handling, target patch composition, validation timing, stream mapping, and trace assembly without knowing each step.

## Principles

### Module

Today, the real patch lifecycle is an unnamed module embedded in `LLMClient.compile(...)`. Naming it as a patch pipeline module gives it one Interface and one Implementation.

### Interface

The Interface becomes the test surface. Tests should ask what the pipeline guarantees: request patches run before prompt patches, contexts refresh, route changes fail, target patches trace after tool-schema patches, validation runs after target patches, and stream patches see the compiled request.

### Depth

The module becomes deep because callers learn a small lifecycle Interface instead of the full phase choreography. More behaviour sits behind less required knowledge.

### Seam

The seam moves from scattered calls to `plan(...)` into the patch pipeline Interface. The existing patch Interface remains the seam where provider-specific patch behaviour enters the lifecycle.

### Adapter

Provider-specific patches are Adapters at the patch seam: each concrete patch satisfies the patch Interface. Adapter-local target patches remain local to the selected Adapter, but the pipeline owns how those patches combine with client registry target patches.

### Leverage

Callers get more leverage because `LLMClient`, tests, and future request-compilation paths can reuse one lifecycle. A fix to context refresh or route protection pays back everywhere.

### Locality

Maintainers get more locality because patch bugs concentrate in the patch pipeline Implementation. Provider patches can stay focused on provider facts instead of lifecycle rules.

### Deletion Test

Deleting the current `plan(...)` helper removes only a small filter/sort/reduce. Deleting the proposed patch pipeline would make lifecycle complexity reappear in `LLMClient`, tests, and any future compilation path. That means the proposed module earns its keep.

### One Adapter = Hypothetical Seam, Two Adapters = Real Seam

This proposal does not add a speculative seam with fake alternative implementations. It deepens an existing real seam: many provider patches already satisfy the patch Interface, and adapter-local plus client registry target patches already vary across providers and call sites. The missing piece is locality for the lifecycle that applies those Adapters.

## Benefits

Locality improves because lifecycle rules live in one module instead of being embedded in request compilation.

Leverage improves because every provider patch and every client path gets the same ordering, trace, validation timing, and route-invariant behaviour.

Tests improve because the patch pipeline Interface becomes the test surface. Instead of constructing fake protocols, fake adapters, fake framing, and scripted HTTP flows to verify patch lifecycle behaviour, tests can exercise the lifecycle directly.

Useful tests:

- Adapter selection happens before request patches.
- Request patches run before prompt patches.
- Prompt patch predicates see the request after request patches.
- Request-shaped patches cannot change `model.provider`, `model.id`, or `model.protocol`.
- Tool-schema patches are skipped when there are no tools.
- Tool-schema traces appear only when tool-schema patches ran.
- Tool-schema trace appears once per matched patch, not once per tool.
- Adapter target patches and client registry target patches follow the shared patch ordering rule.
- Target validation runs after target patches.
- Stream patches see the compiled request, not the original request.
- Pipeline construction accepts `undefined`, a patch array, or a `PatchRegistry`.

## What Not To Do Yet

Do not change the public patch definition shape unless the pipeline proves it needs a missing field.

Do not create a full plugin system for patch ordering.

Do not move provider-specific patch logic into the pipeline.

Do not make target patch typing more ambitious in this step; target patches are already typed at adapter construction sites and erased in the registry.

Do not move Adapter lookup, Protocol lowering, HTTP construction, or stream parsing into the pipeline.

Do not change provider behaviour while extracting the lifecycle.

## Migration Plan

1. Add `src/patch-pipeline.ts` with the lifecycle Implementation and focused tests.
2. Keep `Patch.plan(...)` public during migration and use it internally inside the pipeline.
3. Move `normalizeRegistry(...)` and `ensureSameRoute(...)` from `src/adapter.ts` into the pipeline module.
4. Add `patchRequest(...)` that runs request, prompt, and tool-schema phases and returns a carried request state.
5. Add `patchTarget(...)` that applies adapter-local target patches, client registry target patches, Adapter validation, and returns a carried target state with combined trace.
6. Add `patchStreamEvents(...)` that applies stream patches to parsed `LLMEvent` streams.
7. Add `test/patch-pipeline.test.ts` with lifecycle tests before changing `LLMClient`.
8. Replace handwritten phase choreography in `LLMClient.compile(...)` and `LLMClient.stream(...)` with the pipeline.
9. Keep one adapter-level smoke test proving `LLMClient` invokes patches end-to-end.
10. Move or delete adapter-level lifecycle tests that are now covered by patch pipeline tests.
11. Decide later whether `Patch.plan(...)` remains public or becomes internal.

## Open Questions

Should `Patch.plan(...)` remain public as a low-level primitive, or should the patch pipeline become the only exported lifecycle Interface?

Should stream patches be part of the same pipeline module from the first extraction, or should the first extraction focus only on request-to-target compilation?

Should the pipeline return one combined trace array, or should it preserve phase-grouped traces internally for better debugging while exposing one ordered trace to callers?

Should route protection apply only after request and prompt phases, or should the pipeline also assert that target and stream phases cannot observe changed route state?

Should target patch ordering keep the current global `order`/`id` rule across adapter-local and client registry patches, or should adapter-local target patches get an explicit ordering band before client registry target patches?

## Recommendation

Do this before adding more provider-specific patches. The current shape is already correct enough to extract safely, and the next set of provider quirks will make patch ordering and conversation-shape rules more important. A patch pipeline module would turn implicit lifecycle knowledge into a deep Interface with better locality, better leverage, and a clearer test surface.
