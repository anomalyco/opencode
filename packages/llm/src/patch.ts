import type { LLMEvent, LLMRequest, ModelRef, PatchPhase, Protocol, ToolDefinition, TransportRequest } from "./schema"
import { PatchTrace } from "./schema"

export interface PatchContext {
  readonly request: LLMRequest
  readonly model: ModelRef
  readonly protocol: ModelRef["protocol"]
  readonly small: boolean
  readonly flags: Record<string, string | number | boolean | undefined>
}

export interface Patch<A> {
  readonly id: string
  readonly phase: PatchPhase
  readonly reason: string
  readonly order?: number
  readonly when: (context: PatchContext) => boolean
  readonly apply: (value: A, context: PatchContext) => A
}

export interface AnyPatch {
  readonly id: string
  readonly phase: PatchPhase
  readonly reason: string
  readonly order?: number
  readonly when: (context: PatchContext) => boolean
  readonly apply: (value: never, context: PatchContext) => unknown
}

export interface PatchInput<A> {
  readonly reason: string
  readonly order?: number
  readonly when?: PatchPredicate | ((context: PatchContext) => boolean)
  readonly apply: (value: A, context: PatchContext) => A
}

export interface PatchPredicate {
  (context: PatchContext): boolean
  readonly and: (...predicates: ReadonlyArray<PatchPredicate>) => PatchPredicate
  readonly or: (...predicates: ReadonlyArray<PatchPredicate>) => PatchPredicate
  readonly not: () => PatchPredicate
}

export interface PatchPlan<A> {
  readonly phase: PatchPhase
  readonly patches: ReadonlyArray<Patch<A>>
  readonly trace: ReadonlyArray<PatchTrace>
  readonly apply: (value: A) => A
}

export interface PatchRegistry {
  readonly request: ReadonlyArray<Patch<LLMRequest>>
  readonly prompt: ReadonlyArray<Patch<LLMRequest>>
  readonly toolSchema: ReadonlyArray<Patch<ToolDefinition>>
  readonly target: ReadonlyArray<Patch<unknown>>
  readonly transport: ReadonlyArray<Patch<TransportRequest>>
  readonly stream: ReadonlyArray<Patch<LLMEvent>>
}

export const emptyRegistry: PatchRegistry = {
  request: [],
  prompt: [],
  toolSchema: [],
  target: [],
  transport: [],
  stream: [],
}

export const predicate = (run: (context: PatchContext) => boolean): PatchPredicate => {
  const self = Object.assign(run, {
    and: (...predicates: ReadonlyArray<PatchPredicate>) =>
      predicate((context) => self(context) && predicates.every((item) => item(context))),
    or: (...predicates: ReadonlyArray<PatchPredicate>) =>
      predicate((context) => self(context) || predicates.some((item) => item(context))),
    not: () => predicate((context) => !self(context)),
  })
  return self
}

export const Model = {
  provider: (provider: string) => predicate((context) => context.model.provider === provider),
  protocol: (protocol: Protocol) => predicate((context) => context.protocol === protocol),
  id: (id: string) => predicate((context) => context.model.id === id),
  idIncludes: (value: string) => predicate((context) => context.model.id.toLowerCase().includes(value.toLowerCase())),
}

export const Request = {
  small: () => predicate((context) => context.small),
  flag: (name: string) => predicate((context) => context.flags[name] === true),
}

export const make = <A>(id: string, phase: PatchPhase, input: PatchInput<A>): Patch<A> => ({
  id,
  phase,
  reason: input.reason,
  order: input.order,
  when: input.when ?? (() => true),
  apply: input.apply,
})

export const request = (id: string, input: PatchInput<LLMRequest>) => make(`request.${id}`, "request", input)

export const prompt = (id: string, input: PatchInput<LLMRequest>) => make(`prompt.${id}`, "prompt", input)

export const toolSchema = (id: string, input: PatchInput<ToolDefinition>) => make(`schema.${id}`, "tool-schema", input)

export const target = <A>(id: string, input: PatchInput<A>) => make(`target.${id}`, "target", input)

export const transport = (id: string, input: PatchInput<TransportRequest>) => make(`transport.${id}`, "transport", input)

export const stream = (id: string, input: PatchInput<LLMEvent>) => make(`stream.${id}`, "stream", input)

export function registry(patches: ReadonlyArray<AnyPatch>): PatchRegistry {
  return {
    request: patches.filter((patch): patch is Patch<LLMRequest> => patch.phase === "request"),
    prompt: patches.filter((patch): patch is Patch<LLMRequest> => patch.phase === "prompt"),
    toolSchema: patches.filter((patch): patch is Patch<ToolDefinition> => patch.phase === "tool-schema"),
    target: patches.filter((patch) => patch.phase === "target") as unknown as ReadonlyArray<Patch<unknown>>,
    transport: patches.filter((patch): patch is Patch<TransportRequest> => patch.phase === "transport"),
    stream: patches.filter((patch): patch is Patch<LLMEvent> => patch.phase === "stream"),
  }
}

export function context(input: {
  readonly request: LLMRequest
  readonly small?: boolean
  readonly flags?: Record<string, string | number | boolean | undefined>
}): PatchContext {
  return {
    request: input.request,
    model: input.request.model,
    protocol: input.request.model.protocol,
    small: input.small ?? false,
    flags: input.flags ?? {},
  }
}

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
    trace: patches.map(
      (patch) =>
        new PatchTrace({
          id: patch.id,
          phase: patch.phase,
          reason: patch.reason,
        }),
    ),
    apply: (value) => patches.reduce((next, patch) => patch.apply(next, input.context), value),
  }
}

export function mergeRegistries(registries: ReadonlyArray<PatchRegistry>): PatchRegistry {
  return registries.reduce(
    (merged, registry) => ({
      request: [...merged.request, ...registry.request],
      prompt: [...merged.prompt, ...registry.prompt],
      toolSchema: [...merged.toolSchema, ...registry.toolSchema],
      target: [...merged.target, ...registry.target],
      transport: [...merged.transport, ...registry.transport],
      stream: [...merged.stream, ...registry.stream],
    }),
    emptyRegistry,
  )
}

export * as Patch from "./patch"
