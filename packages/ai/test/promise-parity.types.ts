import type { Effect, Stream } from "effect"
import type { Client, GenerationHandle } from "../src/index.js"
import type { Generation, ai } from "../src/effect.js"

// The Promise `ai` mirrors the Effect `ai`: same namespaces, methods, arguments and results. The only allowed differences
// are `signal` on the options bag, Promise for Effect, AsyncIterable for Stream and GenerationHandle for Generation.

type Equal<A, B> = [A, B] extends [B, A] ? true : false
type Assert<T extends Record<string, true>> = T

type PromiseAI = Omit<Client, "dispose">
type EffectAI = typeof ai
type Helpers = "run" | "bytes" | "base64" | "materialize" | "file" | "write"
type Namespaces = "image" | "decision" | "experimental"

type Signatures<F> = F extends {
  (...args: infer A1): infer R1
  (...args: infer A2): infer R2
  (...args: infer A3): infer R3
}
  ? [A1, R1] | [A2, R2] | [A3, R3]
  : F extends { (...args: infer A1): infer R1; (...args: infer A2): infer R2 }
    ? [A1, R1] | [A2, R2]
    : F extends (...args: infer A) => infer R
      ? [A, R]
      : never

type Positional<P> = P extends readonly [infer A, ...infer Rest] ? [WithoutSignal<A>, ...Positional<Rest>] : []
// Paired with its keys: an options bag of optional fields is otherwise assignable to `{}` and back.
type Options<P> = P extends readonly [unknown, ...infer Rest]
  ? Options<Rest>
  : P extends readonly [(infer O)?]
    ? Keyed<WithoutSignal<NonNullable<O>>>
    : Keyed<{}>
type Keyed<T> = [keyof T, T]
type WithoutSignal<T> = T extends { readonly signal?: AbortSignal } ? Omit<T, "signal"> : T

type Promised<R> =
  R extends Effect.Effect<Generation<infer A>, infer _E, infer _R>
    ? Promise<GenerationHandle<A>>
    : R extends Effect.Effect<infer A, infer _E, infer _R>
      ? Promise<A>
      : R extends Stream.Stream<infer A, infer _E, infer _R>
        ? AsyncIterable<A>
        : R

type EffectShape<F> =
  Signatures<F> extends infer S ? (S extends [infer A, infer R] ? [Positional<A>, Options<A>, Promised<R>] : never) : never
type PromiseShape<F> =
  Signatures<F> extends infer S ? (S extends [infer A, infer R] ? [Positional<A>, Options<A>, R] : never) : never

export type Drift<Promise, Effect> = {
  readonly [K in keyof Promise | keyof Effect]: K extends keyof Promise
    ? K extends keyof Effect
      ? Equal<PromiseShape<Promise[K]>, EffectShape<Effect[K]>>
      : "missing in Effect"
    : "missing in Promise"
}

type Same<A, B> = [Exclude<A, B> | Exclude<B, A>] extends [never] ? true : { readonly drift: Exclude<A, B> | Exclude<B, A> }

export type Checks = [
  Assert<{ handle: Same<keyof GenerationHandle<unknown>, Exclude<keyof Generation<unknown>, "route">> }>,
  Assert<{ keys: Same<Exclude<keyof PromiseAI, Helpers>, keyof EffectAI> }>,
  Assert<{ experimental: Same<keyof PromiseAI["experimental"], keyof EffectAI["experimental"]> }>,
  Assert<Drift<Omit<PromiseAI, Helpers | Namespaces>, Omit<EffectAI, Namespaces>>>,
  Assert<Drift<PromiseAI["image"], EffectAI["image"]>>,
  Assert<Drift<PromiseAI["decision"], EffectAI["decision"]>>,
  Assert<Drift<PromiseAI["experimental"]["speech"], EffectAI["experimental"]["speech"]>>,
  Assert<Drift<PromiseAI["experimental"]["transcription"], EffectAI["experimental"]["transcription"]>>,
  Assert<Drift<PromiseAI["experimental"]["video"], EffectAI["experimental"]["video"]>>,
]
