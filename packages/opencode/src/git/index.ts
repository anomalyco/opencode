import { Effect } from "effect"
import { runtime } from "@/effect/runtime"
import { GitEffect } from "./effect"

function runPromise<A>(f: (service: GitEffect.Interface) => Effect.Effect<A>): Promise<A> {
  return runtime.runPromise(GitEffect.Service.use(f))
}

export namespace Git {
  export type Kind = GitEffect.Kind
  export type Base = GitEffect.Base
  export type Item = GitEffect.Item
  export type Stat = GitEffect.Stat
  export type Result = GitEffect.Result
  export type Options = GitEffect.Options

  export function run(args: string[], opts: Options) {
    return runPromise((git) => git.run(args, opts))
  }

  export function text(args: string[], opts: Options) {
    return runPromise((git) => git.text(args, opts))
  }

  export function lines(args: string[], opts: Options) {
    return runPromise((git) => git.lines(args, opts))
  }

  export function branch(cwd: string) {
    return runPromise((git) => git.branch(cwd))
  }

  export function prefix(cwd: string) {
    return runPromise((git) => git.prefix(cwd))
  }

  export function defaultBranch(cwd: string) {
    return runPromise((git) => git.defaultBranch(cwd))
  }

  export function hasHead(cwd: string) {
    return runPromise((git) => git.hasHead(cwd))
  }

  export function mergeBase(cwd: string, base: string, head?: string) {
    return runPromise((git) => git.mergeBase(cwd, base, head))
  }

  export function show(cwd: string, ref: string, file: string, prefix?: string) {
    return runPromise((git) => git.show(cwd, ref, file, prefix))
  }

  export function status(cwd: string) {
    return runPromise((git) => git.status(cwd))
  }

  export function diff(cwd: string, ref: string) {
    return runPromise((git) => git.diff(cwd, ref))
  }

  export function stats(cwd: string, ref: string) {
    return runPromise((git) => git.stats(cwd, ref))
  }
}
