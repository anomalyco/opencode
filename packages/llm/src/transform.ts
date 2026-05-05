import type { AdapterID, LLMEvent, LLMRequest, ModelRef, ProtocolID, ToolDefinition, TransformPhase } from "./schema"

export interface TransformContext {
  readonly request: LLMRequest
  readonly model: ModelRef
  readonly adapter: ModelRef["adapter"]
  readonly protocol: ModelRef["protocol"]
}

export interface Transform<A, Phase extends TransformPhase = TransformPhase> {
  readonly id: string
  readonly phase: Phase
  readonly reason: string
  readonly order?: number
  readonly when: (context: TransformContext) => boolean
  readonly apply: (value: A, context: TransformContext) => A
}

export interface AnyTransform {
  readonly id: string
  readonly phase: TransformPhase
  readonly reason: string
  readonly order?: number
  readonly when: (context: TransformContext) => boolean
  readonly apply: (value: never, context: TransformContext) => unknown
}

export type AnyRuntimeTransform =
  | Transform<LLMRequest, "request">
  | Transform<LLMRequest, "prompt">
  | Transform<ToolDefinition, "tool-schema">
  | Transform<LLMEvent, "stream">

export interface TransformInput<A> {
  readonly reason: string
  readonly order?: number
  readonly when?: TransformPredicate | ((context: TransformContext) => boolean)
  readonly apply: (value: A, context: TransformContext) => A
}

export interface TransformPredicate {
  (context: TransformContext): boolean
  readonly and: (...predicates: ReadonlyArray<TransformPredicate>) => TransformPredicate
  readonly or: (...predicates: ReadonlyArray<TransformPredicate>) => TransformPredicate
  readonly not: () => TransformPredicate
}

export interface TransformPlan<A> {
  readonly phase: TransformPhase
  readonly transforms: ReadonlyArray<Transform<A>>
  readonly apply: (value: A) => A
}

export interface TransformRegistry {
  readonly request: ReadonlyArray<Transform<LLMRequest, "request">>
  readonly prompt: ReadonlyArray<Transform<LLMRequest, "prompt">>
  readonly toolSchema: ReadonlyArray<Transform<ToolDefinition, "tool-schema">>
  readonly stream: ReadonlyArray<Transform<LLMEvent, "stream">>
}

export const emptyRegistry: TransformRegistry = {
  request: [],
  prompt: [],
  toolSchema: [],
  stream: [],
}

export const predicate = (run: (context: TransformContext) => boolean): TransformPredicate => {
  const self = Object.assign(run, {
    and: (...predicates: ReadonlyArray<TransformPredicate>) =>
      predicate((context) => self(context) && predicates.every((item) => item(context))),
    or: (...predicates: ReadonlyArray<TransformPredicate>) =>
      predicate((context) => self(context) || predicates.some((item) => item(context))),
    not: () => predicate((context) => !self(context)),
  })
  return self
}

export const Model = {
  provider: (provider: string) => predicate((context) => context.model.provider === provider),
  adapter: (adapter: AdapterID) => predicate((context) => context.adapter === adapter),
  protocol: (protocol: ProtocolID) => predicate((context) => context.protocol === protocol),
  id: (id: string) => predicate((context) => context.model.id === id),
  idIncludes: (value: string) => predicate((context) => context.model.id.toLowerCase().includes(value.toLowerCase())),
}

export const make = <A, Phase extends TransformPhase>(id: string, phase: Phase, input: TransformInput<A>): Transform<A, Phase> => ({
  id,
  phase,
  reason: input.reason,
  order: input.order,
  when: input.when ?? (() => true),
  apply: input.apply,
})

export const request = (id: string, input: TransformInput<LLMRequest>) => make(`request.${id}`, "request", input)

export const prompt = (id: string, input: TransformInput<LLMRequest>) => make(`prompt.${id}`, "prompt", input)

export const toolSchema = (id: string, input: TransformInput<ToolDefinition>) => make(`schema.${id}`, "tool-schema", input)

export const payload = <A>(id: string, input: TransformInput<A>) => make(`payload.${id}`, "payload", input)

export const stream = (id: string, input: TransformInput<LLMEvent>) => make(`stream.${id}`, "stream", input)

export function registry(transforms: ReadonlyArray<AnyRuntimeTransform>): TransformRegistry {
  return {
    request: transforms.filter((transform): transform is Transform<LLMRequest, "request"> => transform.phase === "request"),
    prompt: transforms.filter((transform): transform is Transform<LLMRequest, "prompt"> => transform.phase === "prompt"),
    toolSchema: transforms.filter((transform): transform is Transform<ToolDefinition, "tool-schema"> => transform.phase === "tool-schema"),
    stream: transforms.filter((transform): transform is Transform<LLMEvent, "stream"> => transform.phase === "stream"),
  }
}

export function context(input: {
  readonly request: LLMRequest
}): TransformContext {
  return {
    request: input.request,
    model: input.request.model,
    adapter: input.request.model.adapter,
    protocol: input.request.model.protocol,
  }
}

export function plan<A>(input: {
  readonly phase: TransformPhase
  readonly context: TransformContext
  readonly transforms: ReadonlyArray<Transform<A>>
}): TransformPlan<A> {
  const transforms = input.transforms
    .filter((transform) => transform.phase === input.phase && transform.when(input.context))
    .toSorted((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id))

  return {
    phase: input.phase,
    transforms,
    apply: (value) => transforms.reduce((next, transform) => transform.apply(next, input.context), value),
  }
}

export function mergeRegistries(registries: ReadonlyArray<TransformRegistry>): TransformRegistry {
  return registries.reduce(
    (merged, registry) => ({
      request: [...merged.request, ...registry.request],
      prompt: [...merged.prompt, ...registry.prompt],
      toolSchema: [...merged.toolSchema, ...registry.toolSchema],
      stream: [...merged.stream, ...registry.stream],
    }),
    emptyRegistry,
  )
}

export * as Transform from "./transform"
