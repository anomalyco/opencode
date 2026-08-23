# Nonblocking Workspace Initialization Spike

## Question

Can an OpenCode V2 session begin its first model request while a remote
workspace is still provisioning, then have the first filesystem or process
operation join that same provisioning attempt without creating a second
workspace?

The spike must demonstrate both policies:

- eager/nonblocking: provisioning starts before the model request, but the
  model does not wait for readiness;
- lazy: provisioning does not start until an execution-plane operation needs
  it.

This is throwaway investigation code. Keep only the validated interface,
tests, and decision record after the question is answered.

## Non-Goals

- Location-less sessions.
- Simulated shell or filesystem providers.
- Session movement or workspace promotion.
- Changing the existing blocking `workspace.create` behavior.
- Making stdio MCP startup lazy.

## Phase 1: Deterministic Fake Provider

Add a test-only workspace provider whose provisioning is held behind a latch
and which records these timestamps and counts:

- reservation committed;
- provisioning started;
- provisioning ready;
- provider connected;
- model request started;
- first model event received;
- tool requested;
- tool process spawned.

First reproduce the current failure: location initialization reaches an
execution-plane operation before the first model request.

Then make location initialization execution-plane-free for the tested profile:

1. Remove the Plan plugin's activation-time directory creation. File mutation
   already creates parent directories when a plan document is first written.
2. Move the default FileSystemSearch index scan from layer construction to its
   first `find` call. Workerd replaces this layer today, but the default remote
   profile must not provision eagerly either.
3. Make search implementation and executable selection derive from the
   execution environment. The current split selects FFF and resolves the
   ripgrep binary from the OpenCode host, then executes through the workspace
   spawner. For a remote workspace, the provider image owns `rg`; a host path
   must never be sent into the sandbox. Test a driver-provided search override
   or executable resolver before choosing the production interface.
4. Treat configured stdio MCP and third-party activation-time I/O as explicit
   execution-plane requirements, not part of this first slice.
5. Add a regression test that building a location and starting a no-tool model
   request performs no process spawn.

The fake remote driver must fail any command containing a host-absolute binary
path. A remote ripgrep search should use the provider's executable identity
(for example `rg`) or a provider-native search operation. The spike should
determine whether the smallest honest seam is an executable resolver,
capability metadata, or a search override on `Environment.Driver`.

## Phase 2: Workspace Reservation And Readiness

Prototype the smallest additive lifecycle:

```ts
const reservation = yield* workspace.reserve({ provider: "test" })

yield* workspace.reconcile(reservation.id).pipe(Effect.forkDetach)

const session = yield* sessions.create({
  location: {
    directory: AbsolutePath.make("/workspace"),
    workspaceID: reservation.id,
  },
})
```

Required behavior:

- `reserve` validates the provider and durably commits a logical workspace ID
  before external work begins.
- `reconcile` starts or joins one process-local provisioning attempt.
- `connect` and every execution-plane operation pass through `reconcile`.
- Interrupting one waiter does not cancel the shared provisioning attempt.
- A failed attempt settles all current waiters consistently; a later operation
  may retry the same workspace ID.
- Existing `create` remains blocking and is implemented as reserve followed by
  reconcile.

The persisted row may have no binding yet. Persist desired state and completed
attempt facts, not a durable lock claiming that one process is provisioning.

The provider prototype must use the logical workspace ID as an idempotency key.
Repeating reconcile after acknowledgement loss must rediscover the same
physical resource.

## Phase 3: Fake-Provider Acceptance Matrix

Current deterministic result (2026-08-23):

- PASS: eager text-only model execution reaches `LLMClient.stream` while
  provider creation remains blocked; no provider connection occurs.
- PASS: lazy text-only model execution reaches `LLMClient.stream` with zero
  provider creation or connection calls.
- PASS: first process spawn starts lazy provisioning, and concurrent first
  spawns join one provider attempt.
- PASS: interrupting one reconcile waiter does not cancel the shared attempt.
- PASS: one failed attempt settles every waiter and a later reconcile retries
  the same logical workspace ID.
- EXPECTED: configured stdio MCP servers are execution-plane requirements and
  wait for workspace readiness. The text-only SDK acceptance tests therefore
  use an isolated empty configuration rather than inheriting user MCP config.
- OUTSTANDING: an end-to-end model-selected first tool assertion and the
  desired-deletion behavior for destroy during blocked provisioning.

### Eager, Text Only

- Reserve the workspace.
- Start reconcile with provider readiness blocked.
- Create and prompt a session.
- Require model request start before provider readiness.
- Require the text-only turn to settle without a provider connection.
- Release the provider and require the advisory reconcile to settle cleanly.

### Lazy, Text Only

- Reserve without starting reconcile.
- Create and prompt a session.
- Require the text-only turn to settle with zero provisioning calls.

### Lazy, First Tool

- Reserve without starting reconcile.
- Prompt a turn that calls shell or read.
- Require the model request and tool request before provider readiness.
- Require the tool to wait.
- Release the provider and require exactly one provision, connection, and tool
  execution.

### Eager, First Tool

- Start blocked reconcile before prompting.
- Require the model request to begin concurrently.
- Require the tool to join the existing attempt rather than start another.

### Concurrency And Failure

- Two concurrent first tools produce one provision attempt.
- An interrupted tool waiter does not cancel provisioning.
- A transient failed attempt is observed by all current waiters.
- A later tool retries with the same workspace ID.
- Destroy during provisioning records desired deletion and cannot admit a new
  process spawn.

## Phase 4: Modal Consumer

After the fake-provider matrix passes, create an isolated opencode-slack
consumer worktree. Do not repoint the active checkout's machine-global Bun
links. Point that consumer directly at this OpenCode worktree and migrate only
the consumer worktree to the matching SDK and Effect cohort.

Adapt the Modal workspace driver so reconciliation is keyed by OpenCode
workspace ID and records:

- Modal create request start;
- sandbox identity checkpoint;
- daemon ready;
- first connection;
- first process spawn.

Run these cold-workspace scenarios through the real Modal control plane:

1. Eager text-only prompt: first model event occurs before daemon readiness.
2. Eager shell prompt: model/tool selection overlaps provisioning and the tool
   joins the existing sandbox.
3. Lazy text-only prompt: no Modal sandbox is created.
4. Lazy shell prompt: Modal creation starts at the first execution-plane need.
5. Attachment prompt: attachment materialization intentionally waits for the
   workspace and is reported as an execution-plane demand.

Use a deterministic provider-side delay for the ordering assertion. Natural
Modal latency is useful for measurement but is not a reliable correctness
test.

## Durable Object Constraint

An OpenCode DO background fiber is advisory because isolate eviction can stop
it. The durable reservation and provider checkpoint make the next reconcile
safe. For the Slack deployment, WorkspaceDO alarms remain responsible for
provider work that must continue independently of OpenCode DO lifetime.

The Modal acceptance run must include interruption or eviction after sandbox
creation begins and verify that retrying the same logical workspace does not
allocate another sandbox.

## Instrumentation

Capture one timeline per run:

```text
admitted
workspace_reserved
provision_started
model_request_started
first_model_event
tool_requested
workspace_ready
workspace_connected
tool_spawned
turn_settled
```

Report both ordering and durations. The primary invariant is ordering, not a
specific latency target.

## Decision Gates

Proceed from the fake provider to Modal only when:

- location boot performs no execution-plane operation in the no-tool profile;
- eager and lazy tests both pass with a provider held indefinitely;
- concurrent first tools share one attempt;
- waiter interruption is independent from provisioning ownership.

Recommend production implementation only when Modal additionally proves:

- one physical sandbox per logical workspace across retries;
- first model work overlaps cold provisioning;
- lazy text-only sessions allocate no sandbox;
- cleanup remains durable after interruption or eviction.

If these fail, preserve the measurements and remove the prototype rather than
generalizing the lifecycle further.
