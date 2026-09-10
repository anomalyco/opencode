import { describe, expect, test } from "bun:test"
import { SessionClosureModel } from "@/session/closure/model"

type Binding = Extract<SessionClosureModel.Command, { readonly type: "job.bind" }>
type Registration = Extract<SessionClosureModel.Command, { readonly type: "job.register" }>
type Running = Extract<SessionClosureModel.Command, { readonly type: "job.run" }>
type Closing = Extract<SessionClosureModel.Command, { readonly type: "job.close" }>
type Refusal = Extract<SessionClosureModel.Decision, { readonly type: "rejected" }>["reason"]

type Seed = {
  readonly instance: SessionClosureModel.InstanceID
  readonly session: SessionClosureModel.SessionID
  readonly job: SessionClosureModel.JobID
  readonly state: SessionClosureModel.State
}

type Token = {
  readonly request: SessionClosureModel.RequestID
  readonly lifetime: SessionClosureModel.LifetimeID
  readonly scope: SessionClosureModel.ScopeID
  readonly lease: SessionClosureModel.LeaseID
}

type Started = {
  readonly seed: Seed
  readonly token: Token
  readonly state: SessionClosureModel.State
  readonly binding: Binding
}

type Ready = {
  readonly seed: Seed
  readonly token: Token
  readonly state: SessionClosureModel.State
  readonly permit: SessionClosureModel.ArmID
}

function seed(tag: string): Seed {
  const instance = SessionClosureModel.id("instance", `${tag}-instance`)
  const session = SessionClosureModel.id("session", `${tag}-session`)
  const job = SessionClosureModel.id("job", `${tag}-job`)
  const state = SessionClosureModel.make({ instance, sessions: [session] })
  return { instance, session, job, state }
}

function token(tag: string): Token {
  return {
    request: SessionClosureModel.id("request", `${tag}-request`),
    lifetime: SessionClosureModel.id("lifetime", `${tag}-lifetime`),
    scope: SessionClosureModel.id("scope", `${tag}-scope`),
    lease: SessionClosureModel.id("lease", `${tag}-lease`),
  }
}

function bindings(result: SessionClosureModel.Step): Binding[] {
  return result.commands.filter((item): item is Binding => item.type === "job.bind")
}

function registrations(result: SessionClosureModel.Step): Registration[] {
  return result.commands.filter((item): item is Registration => item.type === "job.register")
}

function runs(result: SessionClosureModel.Step): Running[] {
  return result.commands.filter((item): item is Running => item.type === "job.run")
}

function closes(result: SessionClosureModel.Step): Closing[] {
  return result.commands.filter((item): item is Closing => item.type === "job.close")
}

function binding(result: SessionClosureModel.Step): Binding {
  const found = bindings(result)
  expect(found).toHaveLength(1)
  const value = found[0]
  if (!value) throw new Error("expected one job.bind command")
  return value
}

function registration(result: SessionClosureModel.Step): Registration {
  const found = registrations(result)
  expect(found).toHaveLength(1)
  const value = found[0]
  if (!value) throw new Error("expected one job.register command")
  return value
}

function current(state: SessionClosureModel.State, id: SessionClosureModel.JobID): SessionClosureModel.JobView {
  const value = SessionClosureModel.view(state).jobs.find((item) => item.id === id)
  expect(value).toBeDefined()
  if (!value) throw new Error("expected current JobLifetime")
  return value
}

function permit(state: SessionClosureModel.State, id: SessionClosureModel.ArmID): SessionClosureModel.ArmPermitView {
  const value = SessionClosureModel.view(state).armPermits.find((item) => item.id === id)
  expect(value).toBeDefined()
  if (!value) throw new Error("expected ArmPermit")
  return value
}

function lease(state: SessionClosureModel.State, id: SessionClosureModel.LeaseID): SessionClosureModel.LeaseView {
  const value = SessionClosureModel.view(state).leases.find((item) => item.id === id)
  expect(value).toBeDefined()
  if (!value) throw new Error("expected admission lease")
  return value
}

function reserve(
  state: SessionClosureModel.State,
  seed: Seed,
  scope: SessionClosureModel.ScopeID,
  id: SessionClosureModel.LeaseID,
  source: string,
): SessionClosureModel.Step {
  return SessionClosureModel.step(state, {
    type: "lease.reserve",
    instance: seed.instance,
    lease: {
      id,
      session: seed.session,
      epoch: 0n,
      source,
      origin: "internal",
      retry: "initial",
      kind: "pre_bind",
      owner: { type: "scope", id: scope },
    },
  })
}

function begin(seed: Seed, token: Token, state: SessionClosureModel.State, operation?: bigint): Started {
  const reserved = reserve(state, seed, token.scope, token.lease, `${token.request}:start`)
  expect(reserved.decision).toEqual({ type: "applied" })
  expect(lease(reserved.state, token.lease).state).toBe("reserved")
  const revision = SessionClosureModel.view(reserved.state).authorityRevision
  const event: SessionClosureModel.Event =
    operation === undefined
      ? {
          type: "job.start",
          instance: seed.instance,
          request: token.request,
          job: seed.job,
          lifetime: token.lifetime,
          scope: token.scope,
          lease: token.lease,
          epoch: 0n,
          admissionRevision: revision,
        }
      : {
          type: "job.start",
          instance: seed.instance,
          request: token.request,
          job: seed.job,
          lifetime: token.lifetime,
          scope: token.scope,
          lease: token.lease,
          epoch: 0n,
          admissionRevision: revision,
          operationRevision: operation,
        }
  const started = SessionClosureModel.step(reserved.state, event)
  expect(started.decision).toEqual({ type: "applied" })
  return { seed, token, state: started.state, binding: binding(started) }
}

function issue(
  state: SessionClosureModel.State,
  seed: Seed,
  binding: Binding,
  id: SessionClosureModel.ArmID,
): SessionClosureModel.Step {
  return SessionClosureModel.step(state, {
    type: "job.bind",
    instance: seed.instance,
    binding,
    decision: { type: "arm_allowed", permit: id },
  })
}

function consume(
  state: SessionClosureModel.State,
  seed: Seed,
  id: SessionClosureModel.ArmID,
): SessionClosureModel.Step {
  return SessionClosureModel.step(state, {
    type: "job.permit",
    instance: seed.instance,
    permit: id,
    action: "consume",
  })
}

function launch(state: SessionClosureModel.State, seed: Seed, registration: Registration): SessionClosureModel.Step {
  return SessionClosureModel.step(state, {
    type: "job.registered",
    instance: seed.instance,
    registration,
  })
}

function ready(seed: Seed, token: Token, state: SessionClosureModel.State, tag: string): Ready {
  const started = begin(seed, token, state)
  const id = SessionClosureModel.id("arm", `${tag}-permit`)
  const issued = issue(started.state, seed, started.binding, id)
  expect(issued.decision).toEqual({ type: "applied" })
  expect(permit(issued.state, id).state).toBe("issued")
  const consumed = consume(issued.state, seed, id)
  expect(consumed.decision).toEqual({ type: "applied" })
  const launched = launch(consumed.state, seed, registration(consumed))
  expect(launched.decision).toEqual({ type: "applied" })
  expect(current(launched.state, seed.job)).toMatchObject({
    lifetime: token.lifetime,
    state: "armed",
    armAttempt: "armed",
    accepted: [0n],
  })
  return { seed, token, state: launched.state, permit: id }
}

function sequence(tag: string) {
  const root = seed(tag)
  const base = token(`${tag}-base`)
  const started = begin(root, base, root.state)
  const request = SessionClosureModel.id("request", `${tag}-extension-request`)
  const id = SessionClosureModel.id("lease", `${tag}-extension-lease`)
  const reserved = reserve(started.state, root, base.scope, id, `${request}:extend`)
  expect(reserved.decision).toEqual({ type: "applied" })
  const revision = SessionClosureModel.view(reserved.state).authorityRevision
  const queued = SessionClosureModel.step(reserved.state, {
    type: "job.extend",
    instance: root.instance,
    request,
    job: root.job,
    lifetime: base.lifetime,
    lease: id,
    epoch: 0n,
    admissionRevision: revision,
  })
  expect(queued.decision).toEqual({ type: "joined" })
  const first = SessionClosureModel.id("arm", `${tag}-base-permit`)
  const issued = issue(queued.state, root, started.binding, first)
  expect(issued.decision).toEqual({ type: "applied" })
  const consumed = consume(issued.state, root, first)
  expect(consumed.decision).toEqual({ type: "applied" })
  const launched = launch(consumed.state, root, registration(consumed))
  expect(launched.decision).toEqual({ type: "applied" })
  const next = binding(launched)
  expect(next.sequence).toBe(1n)
  const second = SessionClosureModel.id("arm", `${tag}-extension-permit`)
  const allowed = issue(launched.state, root, next, second)
  expect(allowed.decision).toEqual({ type: "applied" })
  const accepted = consume(allowed.state, root, second)
  expect(accepted.decision).toEqual({ type: "applied" })
  const complete = launch(accepted.state, root, registration(accepted))
  expect(complete.decision).toEqual({ type: "applied" })
  expect(current(complete.state, root.job).accepted).toEqual([0n, 1n])
  return { root, base, state: complete.state, first, second }
}

function replace(tag: string) {
  const root = seed(tag)
  const prior = token(`${tag}-prior`)
  const initial = ready(root, prior, root.state, `${tag}-prior`)
  const terminal = SessionClosureModel.step(initial.state, {
    type: "job.terminal",
    instance: root.instance,
    job: root.job,
    lifetime: prior.lifetime,
    winner: "completed",
  })
  expect(terminal.decision).toEqual({ type: "applied" })
  const fresh = token(`${tag}-fresh`)
  const active = ready(root, fresh, terminal.state, `${tag}-fresh`)
  expect(prior.lifetime).not.toBe(fresh.lifetime)
  expect(SessionClosureModel.view(active.state).jobs).toHaveLength(1)
  expect(current(active.state, root.job)).toMatchObject({
    id: root.job,
    lifetime: fresh.lifetime,
    state: "armed",
    accepted: [0n],
  })
  return { root, prior, fresh, state: active.state, old: initial.permit }
}

function reject(started: Started, stale: Binding, id: SessionClosureModel.ArmID, reason: Refusal) {
  const before = SessionClosureModel.view(started.state)
  expect(before.armPermits).toEqual([])
  const result = issue(started.state, started.seed, stale, id)
  expect(result.decision).toEqual({ type: "rejected", reason })
  expect(result.commands).toEqual([])
  expect(SessionClosureModel.view(result.state)).toEqual(before)
}

// Gate-1 traceability only: I-30's real exact-handle get/promote/promotion-wait/terminal-wait, onPromote callback,
// and physical wait/cancel behavior require the BackgroundJob registry at Gate 4 K65/K68/K69/K119.
// Gate-1 traceability only: I-46–I-50's real shared ArmAttempt Deferred, registrar identity, atomic permit CAS,
// no-cross-lock exchange, scoped fork handoff, and binder finalizer require Gate 4 K115–K120.
// Gate-1 traceability only: I-48's reduced adjacent-invocation observer/notification/wake composition requires Gate 8 K121;
// the former per-sequence delivery-ack clause is superseded with its retired ledger.

describe("session closure JobLifetime model", () => {
  // I-47 | boundary: second start before/after bind | mutant: remove current-token join guard | red: another bind appears.
  test("I-47 shares one arm attempt across unarmed and binding starts", () => {
    const root = seed("shared")
    const life = token("shared-owner")
    const owner = begin(root, life, root.state)
    expect(current(owner.state, root.job)).toMatchObject({
      lifetime: life.lifetime,
      state: "registered_unarmed",
      armAttempt: "pending",
      starts: [{ request: life.request, state: "owner" }],
    })

    const peer = SessionClosureModel.id("request", "shared-peer-request")
    const joined = SessionClosureModel.step(owner.state, {
      ...owner.binding,
      type: "job.start",
      request: peer,
      scope: life.scope,
    })
    expect(joined.decision).toEqual({ type: "joined" })
    expect(joined.commands).toEqual([])
    expect(current(joined.state, root.job).starts).toEqual([
      { request: life.request, state: "owner" },
      { request: peer, state: "joined" },
    ])

    const id = SessionClosureModel.id("arm", "shared-permit")
    const issued = issue(joined.state, root, owner.binding, id)
    expect(issued.decision).toEqual({ type: "applied" })
    expect(current(issued.state, root.job).state).toBe("binding")
    expect(permit(issued.state, id).state).toBe("issued")

    const late = SessionClosureModel.id("request", "shared-late-request")
    const binding = SessionClosureModel.step(issued.state, {
      ...owner.binding,
      type: "job.start",
      request: late,
      scope: life.scope,
    })
    expect(binding.decision).toEqual({ type: "joined" })
    expect(binding.commands).toEqual([])
    expect(SessionClosureModel.view(binding.state).armPermits).toHaveLength(1)

    const consumed = consume(binding.state, root, id)
    const launched = launch(consumed.state, root, registration(consumed))
    expect(current(launched.state, root.job)).toMatchObject({
      armAttempt: "armed",
      starts: [
        { request: late, state: "settled" },
        { request: life.request, state: "settled" },
        { request: peer, state: "settled" },
      ],
    })
    expect(runs(launched)).toHaveLength(1)
  })

  // I-46 | boundary: bind/permit/registration | mutant: accept a bind outside registered_unarmed | red: armed token rebinds.
  test("I-46 preserves registered_unarmed to binding to armed to terminal order", () => {
    const root = seed("order")
    const life = token("order")
    const started = begin(root, life, root.state)
    expect(current(started.state, root.job).state).toBe("registered_unarmed")

    const id = SessionClosureModel.id("arm", "order-permit")
    const issued = issue(started.state, root, started.binding, id)
    expect(current(issued.state, root.job)).toMatchObject({ state: "binding", armAttempt: "pending", accepted: [] })
    expect(permit(issued.state, id).state).toBe("issued")
    expect(registrations(issued)).toEqual([])
    expect(runs(issued)).toEqual([])

    const consumed = consume(issued.state, root, id)
    expect(current(consumed.state, root.job)).toMatchObject({
      state: "armed",
      armAttempt: "pending",
      accepted: [0n],
      nextSequence: 1n,
    })
    expect(permit(consumed.state, id).state).toBe("consumed")
    expect(registrations(consumed)).toHaveLength(1)
    expect(runs(consumed)).toEqual([])

    const launched = launch(consumed.state, root, registration(consumed))
    expect(current(launched.state, root.job)).toMatchObject({ state: "armed", armAttempt: "armed" })
    expect(runs(launched)).toHaveLength(1)
    const rebound = issue(launched.state, root, started.binding, SessionClosureModel.id("arm", "order-rebound-permit"))
    expect(rebound.decision).toEqual({ type: "noop", reason: "stale" })
    expect(rebound.commands).toEqual([])
    expect(SessionClosureModel.view(rebound.state)).toEqual(SessionClosureModel.view(launched.state))

    const terminal = SessionClosureModel.step(launched.state, {
      type: "job.terminal",
      instance: root.instance,
      job: root.job,
      lifetime: life.lifetime,
      winner: "completed",
    })
    expect(current(terminal.state, root.job)).toMatchObject({ state: "terminal", winner: "completed" })
  })

  test("retention cleanup waits for an issued permit acknowledgement before removing an exact terminal lifetime", () => {
    const root = seed("retention-ack")
    const life = token("retention-ack")
    const started = begin(root, life, root.state)
    const arm = SessionClosureModel.id("arm", "retention-ack-permit")
    const issued = issue(started.state, root, started.binding, arm)
    const terminal = SessionClosureModel.step(issued.state, {
      type: "job.terminal",
      instance: root.instance,
      job: root.job,
      lifetime: life.lifetime,
      winner: "completed",
    })
    expect(permit(terminal.state, arm).state).toBe("issued")

    const before = SessionClosureModel.view(terminal.state)
    const blocked = SessionClosureModel.step(terminal.state, {
      type: "cleanup",
      instance: root.instance,
      job: root.job,
      lifetime: life.lifetime,
    })
    expect(blocked.decision).toEqual({ type: "rejected", reason: "unverified" })
    expect(SessionClosureModel.view(blocked.state)).toEqual(before)

    const acknowledged = SessionClosureModel.step(blocked.state, {
      type: "cleanup",
      instance: root.instance,
      permit: arm,
    })
    expect(acknowledged.decision).toEqual({ type: "applied" })
    expect(permit(acknowledged.state, arm).state).toBe("revoked")
    expect(SessionClosureModel.view(acknowledged.state).authorityRevision).toBe(before.authorityRevision)

    const compacted = SessionClosureModel.step(acknowledged.state, {
      type: "cleanup",
      instance: root.instance,
      job: root.job,
      lifetime: life.lifetime,
    })
    expect(compacted.decision).toEqual({ type: "applied" })
    expect(SessionClosureModel.view(compacted.state)).toMatchObject({ jobs: [], armPermits: [], leases: [] })
    expect(SessionClosureModel.view(compacted.state).authorityRevision).toBe(before.authorityRevision)
  })

  // I-46 | boundary: late bind after pre-arm cancel | mutant: delete terminal-state bind guard | red: terminal token gets a permit.
  test("I-46 blocks terminal to binding or armed resurrection", () => {
    const root = seed("resurrection")
    const life = token("resurrection")
    const started = begin(root, life, root.state)
    const cancelled = SessionClosureModel.step(started.state, {
      type: "job.cancel",
      instance: root.instance,
      job: root.job,
      lifetime: life.lifetime,
    })
    expect(cancelled.decision).toEqual({ type: "applied" })
    expect(current(cancelled.state, root.job)).toMatchObject({
      state: "terminal",
      armAttempt: "terminal",
      winner: "cancelled",
    })
    expect(closes(cancelled)).toEqual([
      { type: "job.close", instance: root.instance, job: root.job, lifetime: life.lifetime, scope: life.scope },
    ])

    const before = SessionClosureModel.view(cancelled.state)
    const late = issue(
      cancelled.state,
      root,
      started.binding,
      SessionClosureModel.id("arm", "resurrection-late-permit"),
    )
    expect(late.decision).toEqual({ type: "noop", reason: "stale" })
    expect(late.commands).toEqual([])
    expect(SessionClosureModel.view(late.state)).toEqual(before)
  })

  // I-46 | boundary: exact registration callback after terminalization | mutant: delete the terminal guard in registeredJob; red: the token emits job.run and resurrects armed.
  test("I-46 ignores an exact Job registration that arrives after terminalization", () => {
    const root = seed("late-registration")
    const life = token("late-registration")
    const started = begin(root, life, root.state)
    const arm = SessionClosureModel.id("arm", "late-registration-permit")
    const issued = issue(started.state, root, started.binding, arm)
    const consumed = consume(issued.state, root, arm)
    const exact = registration(consumed)

    expect(consumed.decision).toEqual({ type: "applied" })
    expect(permit(consumed.state, arm).state).toBe("consumed")
    expect(current(consumed.state, root.job)).toMatchObject({
      lifetime: life.lifetime,
      state: "armed",
      armAttempt: "pending",
      accepted: [0n],
    })
    expect(registrations(consumed)).toEqual([exact])

    const onTime = launch(consumed.state, root, exact)
    expect(onTime.decision).toEqual({ type: "applied" })
    expect(runs(onTime)).toEqual([
      { type: "job.run", instance: root.instance, job: root.job, lifetime: life.lifetime, sequence: 0n },
    ])
    expect(current(onTime.state, root.job)).toMatchObject({ state: "armed", armAttempt: "armed" })

    const terminal = SessionClosureModel.step(consumed.state, {
      type: "job.terminal",
      instance: root.instance,
      job: root.job,
      lifetime: life.lifetime,
      winner: "completed",
    })
    expect(terminal.decision).toEqual({ type: "applied" })
    expect(current(terminal.state, root.job)).toMatchObject({
      state: "terminal",
      armAttempt: "terminal",
      winner: "completed",
    })
    expect(closes(terminal)).toHaveLength(1)

    const before = SessionClosureModel.view(terminal.state)
    const late = launch(terminal.state, root, exact)
    expect(late.decision).toEqual({ type: "noop", reason: "settled" })
    expect(late.commands).toEqual([])
    expect(SessionClosureModel.view(late.state)).toEqual(before)
  })

  // I-46 | boundary: fresh start admission after terminalization | mutant: delete the same-lifetime terminal guard in startJob; red: the terminal token is recreated as registered_unarmed.
  test("I-46 rejects a same-token Job restart after terminalization", () => {
    const root = seed("same-token-restart")
    const life = token("same-token-restart")
    const armed = ready(root, life, root.state, "same-token-restart")
    const terminal = SessionClosureModel.step(armed.state, {
      type: "job.terminal",
      instance: root.instance,
      job: root.job,
      lifetime: life.lifetime,
      winner: "completed",
    })
    expect(terminal.decision).toEqual({ type: "applied" })
    expect(current(terminal.state, root.job)).toMatchObject({
      lifetime: life.lifetime,
      state: "terminal",
      armAttempt: "terminal",
    })

    const retry = token("same-token-restart-retry")
    const reserved = reserve(terminal.state, root, retry.scope, retry.lease, `${retry.request}:restart`)
    expect(reserved.decision).toEqual({ type: "applied" })
    expect(lease(reserved.state, retry.lease).state).toBe("reserved")
    const revision = SessionClosureModel.view(reserved.state).authorityRevision
    const event: SessionClosureModel.Event = {
      type: "job.start",
      instance: root.instance,
      request: retry.request,
      job: root.job,
      lifetime: life.lifetime,
      scope: retry.scope,
      lease: retry.lease,
      epoch: 0n,
      admissionRevision: revision,
    }
    const before = SessionClosureModel.view(reserved.state)
    const stale = SessionClosureModel.step(reserved.state, event)
    expect(stale.decision).toEqual({ type: "rejected", reason: "stale_token" })
    expect(stale.commands).toEqual([])
    expect(SessionClosureModel.view(stale.state)).toEqual(before)

    const freshLifetime = SessionClosureModel.id("lifetime", "same-token-restart-fresh-lifetime")
    const fresh = SessionClosureModel.step(reserved.state, { ...event, lifetime: freshLifetime })
    expect(fresh.decision).toEqual({ type: "applied" })
    expect(bindings(fresh)).toHaveLength(1)
    expect(current(fresh.state, root.job)).toMatchObject({
      lifetime: freshLifetime,
      state: "registered_unarmed",
      armAttempt: "pending",
    })
  })

  // I-48 | boundary: base registration settles arm attempt | mutant: reserve sequence one before base arm settles | red: extension binds early.
  test("I-48 holds extensions without a sequence until sequence zero arms", () => {
    const root = seed("extension-order")
    const life = token("extension-order")
    const started = begin(root, life, root.state)
    const request = SessionClosureModel.id("request", "extension-order-next-request")
    const id = SessionClosureModel.id("lease", "extension-order-next-lease")
    const reserved = reserve(started.state, root, life.scope, id, "extension-order")
    expect(reserved.decision).toEqual({ type: "applied" })
    const revision = SessionClosureModel.view(reserved.state).authorityRevision
    const queued = SessionClosureModel.step(reserved.state, {
      type: "job.extend",
      instance: root.instance,
      request,
      job: root.job,
      lifetime: life.lifetime,
      lease: id,
      epoch: 0n,
      admissionRevision: revision,
    })
    expect(queued.decision).toEqual({ type: "joined" })
    expect(queued.commands).toEqual([])
    expect(current(queued.state, root.job).extensions).toEqual([{ request, state: "waiting_for_arm" }])

    const arm = SessionClosureModel.id("arm", "extension-order-base-permit")
    const issued = issue(queued.state, root, started.binding, arm)
    const consumed = consume(issued.state, root, arm)
    expect(current(consumed.state, root.job)).toMatchObject({
      accepted: [0n],
      armAttempt: "pending",
      extensions: [{ request, state: "waiting_for_arm" }],
    })
    expect(bindings(consumed)).toEqual([])

    const launched = launch(consumed.state, root, registration(consumed))
    expect(runs(launched)).toEqual([
      { type: "job.run", instance: root.instance, job: root.job, lifetime: life.lifetime, sequence: 0n },
    ])
    expect(binding(launched)).toMatchObject({
      job: root.job,
      lifetime: life.lifetime,
      sequence: 1n,
      lease: id,
    })
    expect(current(launched.state, root.job)).toMatchObject({
      accepted: [0n],
      nextSequence: 2n,
      extensions: [{ request, state: "binding", sequence: 1n }],
    })
  })

  // I-48 | boundary: delivery admission | mutant: omit scope from the dedupe key | red: same-sequence second scope disappears.
  test("I-48 keeps sequence and scope delivery accounting distinct", () => {
    const setup = sequence("delivery")
    const first = SessionClosureModel.id("scope", "delivery-first-scope")
    const second = SessionClosureModel.id("scope", "delivery-second-scope")
    const third = SessionClosureModel.id("scope", "delivery-third-scope")
    const delivered = SessionClosureModel.step(setup.state, {
      type: "job.deliver",
      instance: setup.root.instance,
      job: setup.root.job,
      lifetime: setup.base.lifetime,
      sequence: 0n,
      scope: first,
    })
    expect(delivered.decision).toEqual({ type: "applied" })
    const adjacent = SessionClosureModel.step(delivered.state, {
      type: "job.deliver",
      instance: setup.root.instance,
      job: setup.root.job,
      lifetime: setup.base.lifetime,
      sequence: 1n,
      scope: second,
    })
    expect(adjacent.decision).toEqual({ type: "applied" })
    const scoped = SessionClosureModel.step(adjacent.state, {
      type: "job.deliver",
      instance: setup.root.instance,
      job: setup.root.job,
      lifetime: setup.base.lifetime,
      sequence: 1n,
      scope: third,
    })
    expect(scoped.decision).toEqual({ type: "applied" })
    expect(current(scoped.state, setup.root.job).delivered).toEqual([
      { sequence: 0n, scope: first },
      { sequence: 1n, scope: second },
      { sequence: 1n, scope: third },
    ])

    const duplicate = SessionClosureModel.step(scoped.state, {
      type: "job.deliver",
      instance: setup.root.instance,
      job: setup.root.job,
      lifetime: setup.base.lifetime,
      sequence: 1n,
      scope: third,
    })
    expect(duplicate.decision).toEqual({ type: "noop", reason: "duplicate" })
    expect(SessionClosureModel.view(duplicate.state)).toEqual(SessionClosureModel.view(scoped.state))
  })

  // I-48 | boundary: cancel through sequence one | mutant: store a sequence-local winner | red: lifetime remains armed or split.
  test("I-48 makes cancellation and its winner lifetime-wide", () => {
    const setup = sequence("cancel-scope")
    const cancelled = SessionClosureModel.step(setup.state, {
      type: "job.cancel",
      instance: setup.root.instance,
      job: setup.root.job,
      lifetime: setup.base.lifetime,
      sequence: 1n,
    })
    expect(cancelled.decision).toEqual({ type: "applied" })
    expect(current(cancelled.state, setup.root.job)).toMatchObject({
      state: "terminal",
      accepted: [0n, 1n],
      winner: "cancelled",
    })
    expect(closes(cancelled)).toHaveLength(1)

    const first = SessionClosureModel.step(cancelled.state, {
      type: "job.observe",
      instance: setup.root.instance,
      job: setup.root.job,
      lifetime: setup.base.lifetime,
      sequence: 0n,
    })
    const second = SessionClosureModel.step(first.state, {
      type: "job.observe",
      instance: setup.root.instance,
      job: setup.root.job,
      lifetime: setup.base.lifetime,
      sequence: 1n,
    })
    expect(first.decision).toEqual({ type: "applied" })
    expect(second.decision).toEqual({ type: "applied" })
    expect(current(second.state, setup.root.job)).toMatchObject({ observed: [0n, 1n], winner: "cancelled" })
  })

  // I-49 | boundary: revoke then consume | mutant: delete issued-state CAS on consume | red: revoked permit registers work.
  test("I-49 makes revoke-first terminal with zero registration or run", () => {
    const root = seed("revoke")
    const life = token("revoke")
    const started = begin(root, life, root.state)
    const id = SessionClosureModel.id("arm", "revoke-permit")
    const issued = issue(started.state, root, started.binding, id)
    expect(permit(issued.state, id).state).toBe("issued")

    const revoked = SessionClosureModel.step(issued.state, {
      type: "job.permit",
      instance: root.instance,
      permit: id,
      action: "revoke",
    })
    expect(revoked.decision).toEqual({ type: "applied" })
    expect(permit(revoked.state, id).state).toBe("revoked")
    expect(current(revoked.state, root.job)).toMatchObject({ state: "terminal", armAttempt: "terminal" })
    expect(closes(revoked)).toHaveLength(1)
    expect(registrations(revoked)).toEqual([])
    expect(runs(revoked)).toEqual([])

    const before = SessionClosureModel.view(revoked.state)
    const stale = consume(revoked.state, root, id)
    expect(stale.decision).toEqual({ type: "noop", reason: "stale" })
    expect(stale.commands).toEqual([])
    expect(SessionClosureModel.view(stale.state)).toEqual(before)
  })

  // I-49 | boundary: consume then duplicate/revoke | mutant: omit issued-to-consumed CAS | red: permit is claimed twice or revoked late.
  test("I-49 consumes one exact permit once and preserves consume-first", () => {
    const root = seed("consume")
    const life = token("consume")
    const started = begin(root, life, root.state)
    const id = SessionClosureModel.id("arm", "consume-permit")
    const issued = issue(started.state, root, started.binding, id)
    const consumed = consume(issued.state, root, id)
    expect(consumed.decision).toEqual({ type: "applied" })
    expect(permit(consumed.state, id).state).toBe("consumed")
    expect(current(consumed.state, root.job)).toMatchObject({ state: "armed", accepted: [0n] })
    expect(registrations(consumed)).toHaveLength(1)
    expect(runs(consumed)).toEqual([])

    const duplicate = consume(consumed.state, root, id)
    expect(duplicate.decision).toEqual({ type: "noop", reason: "duplicate" })
    expect(duplicate.commands).toEqual([])
    expect(SessionClosureModel.view(duplicate.state)).toEqual(SessionClosureModel.view(consumed.state))
    const revoked = SessionClosureModel.step(consumed.state, {
      type: "job.permit",
      instance: root.instance,
      permit: id,
      action: "revoke",
    })
    expect(revoked.decision).toEqual({ type: "noop", reason: "stale" })
    expect(permit(revoked.state, id).state).toBe("consumed")
    expect(revoked.commands).toEqual([])
  })

  // I-49 | boundary: cancel after permit consumption | mutant: revoke consumed authority instead of adopting its lifetime | red: winner/permit state.
  test("I-49 consume-first later cancels the whole adopted lifetime", () => {
    const root = seed("consume-adopt")
    const life = token("consume-adopt")
    const started = begin(root, life, root.state)
    const id = SessionClosureModel.id("arm", "consume-adopt-permit")
    const issued = issue(started.state, root, started.binding, id)
    const consumed = consume(issued.state, root, id)
    expect(consumed.decision).toEqual({ type: "applied" })
    expect(permit(consumed.state, id).state).toBe("consumed")
    expect(registrations(consumed)).toHaveLength(1)
    expect(current(consumed.state, root.job)).toMatchObject({ state: "armed", accepted: [0n] })

    const cancelled = SessionClosureModel.step(consumed.state, {
      type: "job.cancel",
      instance: root.instance,
      job: root.job,
      lifetime: life.lifetime,
      sequence: 0n,
    })
    expect(cancelled.decision).toEqual({ type: "applied" })
    expect(permit(cancelled.state, id).state).toBe("consumed")
    expect(current(cancelled.state, root.job)).toMatchObject({
      lifetime: life.lifetime,
      state: "terminal",
      accepted: [0n],
      winner: "cancelled",
    })
    expect(closes(cancelled)).toEqual([
      { type: "job.close", instance: root.instance, job: root.job, lifetime: life.lifetime, scope: life.scope },
    ])
    expect(registrations(cancelled)).toEqual([])
    expect(runs(cancelled)).toEqual([])
  })

  // I-49 | boundary: arm_allowed result validation | mutant: delete lifetime comparison | red: stale-token permit is issued.
  test("I-49 refuses an arm result carrying another lifetime token", () => {
    const root = seed("permit-token")
    const life = token("permit-token")
    const started = begin(root, life, root.state)
    const stale: Binding = {
      ...started.binding,
      lifetime: SessionClosureModel.id("lifetime", "permit-token-stale-lifetime"),
    }
    reject(started, stale, SessionClosureModel.id("arm", "permit-token-stale-permit"), "stale_token")
  })

  // I-49 | boundary: arm_allowed result validation | mutant: delete sequence comparison | red: sequence-one permit arms base.
  test("I-49 refuses an arm result carrying the wrong sequence", () => {
    const root = seed("permit-sequence")
    const life = token("permit-sequence")
    const started = begin(root, life, root.state)
    const stale: Binding = { ...started.binding, sequence: 1n }
    reject(started, stale, SessionClosureModel.id("arm", "permit-sequence-stale-permit"), "stale_sequence")
  })

  // I-49 | boundary: arm_allowed result validation | mutant: delete epoch comparison | red: wrong-epoch permit is issued.
  test("I-49 refuses an arm result carrying the wrong epoch", () => {
    const root = seed("permit-epoch")
    const life = token("permit-epoch")
    const started = begin(root, life, root.state)
    const stale: Binding = { ...started.binding, epoch: started.binding.epoch + 1n }
    reject(started, stale, SessionClosureModel.id("arm", "permit-epoch-stale-permit"), "stale_epoch")
  })

  // I-49 | boundary: arm_allowed result validation | mutant: delete admission-revision comparison | red: stale permit is issued.
  test("I-49 refuses an arm result carrying the wrong admission revision", () => {
    const root = seed("permit-admission")
    const life = token("permit-admission")
    const started = begin(root, life, root.state)
    const stale: Binding = {
      ...started.binding,
      admissionRevision: started.binding.admissionRevision + 1n,
    }
    reject(started, stale, SessionClosureModel.id("arm", "permit-admission-stale-permit"), "stale_revision")
  })

  // I-49 | boundary: arm_allowed result validation | mutant: delete operation-revision comparison | red: stale permit is issued.
  test("I-49 refuses an arm result carrying the wrong operation revision", () => {
    const root = seed("permit-operation")
    const life = token("permit-operation")
    const started = begin(root, life, root.state, 7n)
    const exact = SessionClosureModel.id("arm", "permit-operation-exact-permit")
    const allowed = issue(started.state, root, started.binding, exact)
    expect(allowed.decision).toEqual({ type: "applied" })
    expect(permit(allowed.state, exact)).toMatchObject({ operationRevision: 7n, state: "issued" })
    const consumed = consume(allowed.state, root, exact)
    expect(consumed.decision).toEqual({ type: "applied" })
    expect(permit(consumed.state, exact).state).toBe("consumed")
    expect(registrations(consumed)).toHaveLength(1)

    const stale: Binding = { ...started.binding, operationRevision: 8n }
    reject(started, stale, SessionClosureModel.id("arm", "permit-operation-stale-permit"), "stale_revision")
  })

  // I-50 | boundary: binder failure | mutant: leave the joined start unsettled | red: starts terminal snapshot differs.
  test("I-50 settles owner joiner and queued extension without forking", () => {
    const root = seed("binder-failure")
    const life = token("binder-failure")
    const owner = begin(root, life, root.state)
    const peer = SessionClosureModel.id("request", "binder-failure-z-peer-request")
    const joined = SessionClosureModel.step(owner.state, {
      ...owner.binding,
      type: "job.start",
      request: peer,
      scope: life.scope,
    })
    expect(joined.decision).toEqual({ type: "joined" })
    const request = SessionClosureModel.id("request", "binder-failure-extension-request")
    const id = SessionClosureModel.id("lease", "binder-failure-extension-lease")
    const reserved = reserve(joined.state, root, life.scope, id, "binder-failure-extension")
    expect(reserved.decision).toEqual({ type: "applied" })
    const revision = SessionClosureModel.view(reserved.state).authorityRevision
    const queued = SessionClosureModel.step(reserved.state, {
      type: "job.extend",
      instance: root.instance,
      request,
      job: root.job,
      lifetime: life.lifetime,
      lease: id,
      epoch: 0n,
      admissionRevision: revision,
    })
    expect(queued.decision).toEqual({ type: "joined" })
    expect(current(queued.state, root.job)).toMatchObject({
      state: "registered_unarmed",
      armAttempt: "pending",
      starts: [
        { request: life.request, state: "owner" },
        { request: peer, state: "joined" },
      ],
      extensions: [{ request, state: "waiting_for_arm" }],
    })

    const failed = SessionClosureModel.step(queued.state, {
      type: "job.binder_failed",
      instance: root.instance,
      job: root.job,
      lifetime: life.lifetime,
    })
    expect(failed.decision).toEqual({ type: "applied" })
    expect(current(failed.state, root.job)).toMatchObject({
      state: "terminal",
      armAttempt: "terminal",
      starts: [
        { request: life.request, state: "settled" },
        { request: peer, state: "settled" },
      ],
      extensions: [{ request, state: "settled" }],
      winner: "error",
    })
    expect(lease(failed.state, life.lease).state).toBe("retired")
    expect(lease(failed.state, id).state).toBe("retired")
    expect(closes(failed)).toEqual([
      { type: "job.close", instance: root.instance, job: root.job, lifetime: life.lifetime, scope: life.scope },
    ])
    expect(registrations(failed)).toEqual([])
    expect(runs(failed)).toEqual([])
  })

  // I-30/K68-K69 | boundary: job.get tuple validation | mutant: resolve get by public JobID only | red: stale T0 get accepts T1.
  test("I-30 job.get covers valid invalid stale and terminal lifetimes", () => {
    const absent = seed("get-absent")
    const missing = token("get-absent")
    const empty = SessionClosureModel.view(absent.state)
    const invalid = SessionClosureModel.step(absent.state, {
      type: "job.get",
      instance: absent.instance,
      job: absent.job,
      lifetime: missing.lifetime,
    })
    expect(invalid.decision).toEqual({ type: "rejected", reason: "invalid_transition" })
    expect(invalid.commands).toEqual([])
    expect(SessionClosureModel.view(invalid.state)).toEqual(empty)

    const root = seed("get-valid")
    const life = token("get-valid")
    const live = ready(root, life, root.state, "get-valid")
    const snapshot = SessionClosureModel.view(live.state)
    const exact = SessionClosureModel.step(live.state, {
      type: "job.get",
      instance: root.instance,
      job: root.job,
      lifetime: life.lifetime,
    })
    expect(exact.decision).toEqual({ type: "applied" })
    expect(exact.commands).toEqual([])
    expect(SessionClosureModel.view(exact.state)).toEqual(snapshot)

    const ended = SessionClosureModel.step(live.state, {
      type: "job.terminal",
      instance: root.instance,
      job: root.job,
      lifetime: life.lifetime,
      winner: "completed",
    })
    expect(current(ended.state, root.job)).toMatchObject({ state: "terminal", winner: "completed" })
    const terminal = SessionClosureModel.view(ended.state)
    const read = SessionClosureModel.step(ended.state, {
      type: "job.get",
      instance: root.instance,
      job: root.job,
      lifetime: life.lifetime,
    })
    expect(read.decision).toEqual({ type: "applied" })
    expect(read.commands).toEqual([])
    expect(SessionClosureModel.view(read.state)).toEqual(terminal)

    const setup = replace("get-stale")
    const before = SessionClosureModel.view(setup.state)
    const stale = SessionClosureModel.step(setup.state, {
      type: "job.get",
      instance: setup.root.instance,
      job: setup.root.job,
      lifetime: setup.prior.lifetime,
    })
    expect(stale.decision).toEqual({ type: "rejected", reason: "stale_token" })
    expect(stale.commands).toEqual([])
    expect(SessionClosureModel.view(stale.state)).toEqual(before)
  })

  // I-30/K68-K69 | boundary: job.promote tuple/state validation | mutant: resolve promote by JobID only | red: stale T0 promotes T1.
  test("I-30 job.promote covers valid invalid stale and terminal lifetimes", () => {
    const root = seed("promote-invalid")
    const life = token("promote-invalid")
    const started = begin(root, life, root.state)
    expect(current(started.state, root.job)).toMatchObject({ state: "registered_unarmed", promoted: false })
    const unarmed = SessionClosureModel.view(started.state)
    const invalid = SessionClosureModel.step(started.state, {
      type: "job.promote",
      instance: root.instance,
      job: root.job,
      lifetime: life.lifetime,
    })
    expect(invalid.decision).toEqual({ type: "rejected", reason: "invalid_transition" })
    expect(invalid.commands).toEqual([])
    expect(SessionClosureModel.view(invalid.state)).toEqual(unarmed)

    const active = seed("promote-valid")
    const candidate = token("promote-valid")
    const live = ready(active, candidate, active.state, "promote-valid")
    expect(current(live.state, active.job).promoted).toBe(false)
    const promoted = SessionClosureModel.step(live.state, {
      type: "job.promote",
      instance: active.instance,
      job: active.job,
      lifetime: candidate.lifetime,
    })
    expect(promoted.decision).toEqual({ type: "applied" })
    expect(promoted.commands).toEqual([])
    expect(current(promoted.state, active.job)).toMatchObject({ state: "armed", promoted: true })

    const finished = seed("promote-terminal")
    const done = token("promote-terminal")
    const armed = ready(finished, done, finished.state, "promote-terminal")
    const ended = SessionClosureModel.step(armed.state, {
      type: "job.terminal",
      instance: finished.instance,
      job: finished.job,
      lifetime: done.lifetime,
      winner: "completed",
    })
    expect(current(ended.state, finished.job)).toMatchObject({ state: "terminal", promoted: false })
    const terminal = SessionClosureModel.view(ended.state)
    const settled = SessionClosureModel.step(ended.state, {
      type: "job.promote",
      instance: finished.instance,
      job: finished.job,
      lifetime: done.lifetime,
    })
    expect(settled.decision).toEqual({ type: "noop", reason: "settled" })
    expect(settled.commands).toEqual([])
    expect(SessionClosureModel.view(settled.state)).toEqual(terminal)

    const setup = replace("promote-stale")
    const before = SessionClosureModel.view(setup.state)
    expect(current(setup.state, setup.root.job).promoted).toBe(false)
    const stale = SessionClosureModel.step(setup.state, {
      type: "job.promote",
      instance: setup.root.instance,
      job: setup.root.job,
      lifetime: setup.prior.lifetime,
    })
    expect(stale.decision).toEqual({ type: "rejected", reason: "stale_token" })
    expect(stale.commands).toEqual([])
    expect(SessionClosureModel.view(stale.state)).toEqual(before)
  })

  // I-30/K68-K69 | boundary: promotion-wait tuple/state validation | mutant: resolve wait by JobID only | red: stale T0 joins T1 wait.
  test("I-30 job.wait_promotion covers valid invalid stale and terminal lifetimes", () => {
    const root = seed("promotion-wait-invalid")
    const life = token("promotion-wait-invalid")
    const started = begin(root, life, root.state)
    expect(current(started.state, root.job)).toMatchObject({ state: "registered_unarmed", promoted: false })
    const unarmed = SessionClosureModel.view(started.state)
    const invalid = SessionClosureModel.step(started.state, {
      type: "job.wait_promotion",
      instance: root.instance,
      job: root.job,
      lifetime: life.lifetime,
    })
    expect(invalid.decision).toEqual({ type: "rejected", reason: "invalid_transition" })
    expect(invalid.commands).toEqual([])
    expect(SessionClosureModel.view(invalid.state)).toEqual(unarmed)

    const active = seed("promotion-wait-valid")
    const candidate = token("promotion-wait-valid")
    const live = ready(active, candidate, active.state, "promotion-wait-valid")
    expect(current(live.state, active.job)).toMatchObject({ state: "armed", promoted: false })
    const snapshot = SessionClosureModel.view(live.state)
    const waiting = SessionClosureModel.step(live.state, {
      type: "job.wait_promotion",
      instance: active.instance,
      job: active.job,
      lifetime: candidate.lifetime,
    })
    expect(waiting.decision).toEqual({ type: "joined" })
    expect(waiting.commands).toEqual([])
    expect(SessionClosureModel.view(waiting.state)).toEqual(snapshot)

    const finished = seed("promotion-wait-terminal")
    const done = token("promotion-wait-terminal")
    const armed = ready(finished, done, finished.state, "promotion-wait-terminal")
    const ended = SessionClosureModel.step(armed.state, {
      type: "job.terminal",
      instance: finished.instance,
      job: finished.job,
      lifetime: done.lifetime,
      winner: "completed",
    })
    expect(current(ended.state, finished.job)).toMatchObject({ state: "terminal", promoted: false })
    const terminal = SessionClosureModel.view(ended.state)
    const settled = SessionClosureModel.step(ended.state, {
      type: "job.wait_promotion",
      instance: finished.instance,
      job: finished.job,
      lifetime: done.lifetime,
    })
    expect(settled.decision).toEqual({ type: "noop", reason: "settled" })
    expect(settled.commands).toEqual([])
    expect(SessionClosureModel.view(settled.state)).toEqual(terminal)

    const setup = replace("promotion-wait-stale")
    const before = SessionClosureModel.view(setup.state)
    const stale = SessionClosureModel.step(setup.state, {
      type: "job.wait_promotion",
      instance: setup.root.instance,
      job: setup.root.job,
      lifetime: setup.prior.lifetime,
    })
    expect(stale.decision).toEqual({ type: "rejected", reason: "stale_token" })
    expect(stale.commands).toEqual([])
    expect(SessionClosureModel.view(stale.state)).toEqual(before)
  })

  // I-30 | boundary: trusted physical wait/cancel | mutant: resolve by public JobID only | red: stale T0 touches T1.
  test("I-30 refuses stale physical wait and cancel after public ID reuse", () => {
    const setup = replace("physical-aba")
    const before = SessionClosureModel.view(setup.state)
    const waited = SessionClosureModel.step(setup.state, {
      type: "job.wait",
      instance: setup.root.instance,
      job: setup.root.job,
      lifetime: setup.prior.lifetime,
    })
    expect(waited.decision).toEqual({ type: "rejected", reason: "stale_token" })
    expect(waited.commands).toEqual([])
    expect(SessionClosureModel.view(waited.state)).toEqual(before)

    const cancelled = SessionClosureModel.step(setup.state, {
      type: "job.cancel",
      instance: setup.root.instance,
      job: setup.root.job,
      lifetime: setup.prior.lifetime,
      sequence: 0n,
    })
    expect(cancelled.decision).toEqual({ type: "rejected", reason: "stale_token" })
    expect(cancelled.commands).toEqual([])
    expect(SessionClosureModel.view(cancelled.state)).toEqual(before)
  })

  // I-30 | boundary: invocation observation | mutant: compare public ID+sequence but not lifetime | red: T0 observes T1.
  test("I-30 refuses a reused sequence from a stale lifetime", () => {
    const setup = replace("observe-aba")
    const before = SessionClosureModel.view(setup.state)
    expect(current(setup.state, setup.root.job).accepted).toEqual([0n])
    const observed = SessionClosureModel.step(setup.state, {
      type: "job.observe",
      instance: setup.root.instance,
      job: setup.root.job,
      lifetime: setup.prior.lifetime,
      sequence: 0n,
    })
    expect(observed.decision).toEqual({ type: "rejected", reason: "stale_token" })
    expect(observed.commands).toEqual([])
    expect(SessionClosureModel.view(observed.state)).toEqual(before)
  })

  // I-30 | boundary: invocation observation | mutant: delete accepted-sequence membership check | red: unaccepted sequence observes.
  test("I-30 refuses an unaccepted sequence on the current lifetime", () => {
    const setup = replace("sequence-aba")
    const before = SessionClosureModel.view(setup.state)
    expect(current(setup.state, setup.root.job).accepted).toEqual([0n])
    const stale = SessionClosureModel.step(setup.state, {
      type: "job.observe",
      instance: setup.root.instance,
      job: setup.root.job,
      lifetime: setup.fresh.lifetime,
      sequence: 1n,
    })
    expect(stale.decision).toEqual({ type: "rejected", reason: "stale_sequence" })
    expect(stale.commands).toEqual([])
    expect(SessionClosureModel.view(stale.state)).toEqual(before)

    const exact = SessionClosureModel.step(setup.state, {
      type: "job.observe",
      instance: setup.root.instance,
      job: setup.root.job,
      lifetime: setup.fresh.lifetime,
      sequence: 0n,
    })
    expect(exact.decision).toEqual({ type: "applied" })
    expect(current(exact.state, setup.root.job).observed).toEqual([0n])
  })

  // I-30/I-49 | boundary: issued old permit against binding replacement | mutant: map permit by JobID+sequence | red: T0 arms T1.
  test("I-30 settles an issued old permit without arming a fresh same-ID lifetime", () => {
    const root = seed("permit-aba")
    const prior = token("permit-aba-prior")
    const started = begin(root, prior, root.state)
    const old = SessionClosureModel.id("arm", "permit-aba-old-permit")
    const issued = issue(started.state, root, started.binding, old)
    expect(permit(issued.state, old).state).toBe("issued")
    expect(current(issued.state, root.job)).toMatchObject({ lifetime: prior.lifetime, state: "binding" })
    const terminal = SessionClosureModel.step(issued.state, {
      type: "job.terminal",
      instance: root.instance,
      job: root.job,
      lifetime: prior.lifetime,
      winner: "error",
    })
    expect(terminal.decision).toEqual({ type: "applied" })
    expect(current(terminal.state, root.job)).toMatchObject({
      lifetime: prior.lifetime,
      state: "terminal",
      winner: "error",
    })
    expect(permit(terminal.state, old).state).toBe("issued")

    const fresh = token("permit-aba-fresh")
    const replacement = begin(root, fresh, terminal.state)
    const exact = SessionClosureModel.id("arm", "permit-aba-fresh-permit")
    const binding = issue(replacement.state, root, replacement.binding, exact)
    expect(binding.decision).toEqual({ type: "applied" })
    expect(permit(binding.state, old).state).toBe("issued")
    expect(permit(binding.state, exact).state).toBe("issued")
    expect(current(binding.state, root.job)).toMatchObject({
      lifetime: fresh.lifetime,
      state: "binding",
      accepted: [],
    })
    const stale = consume(binding.state, root, old)
    expect(stale.decision).toEqual({ type: "applied" })
    expect(stale.commands).toEqual([
      { type: "job.cleanup", instance: root.instance, job: root.job, lifetime: prior.lifetime },
    ])
    expect(permit(stale.state, old).state).toBe("consumed")
    expect(permit(stale.state, exact).state).toBe("issued")
    expect(current(stale.state, root.job)).toMatchObject({ lifetime: fresh.lifetime, state: "binding", accepted: [] })

    const cleanup = SessionClosureModel.step(stale.state, {
      type: "cleanup",
      instance: root.instance,
      job: root.job,
      lifetime: prior.lifetime,
    })
    expect(cleanup.decision).toEqual({ type: "applied" })
    expect(SessionClosureModel.view(cleanup.state).armPermits.map((item) => item.id)).toEqual([exact])
    expect(current(cleanup.state, root.job)).toMatchObject({ lifetime: fresh.lifetime, state: "binding", accepted: [] })
  })
})
