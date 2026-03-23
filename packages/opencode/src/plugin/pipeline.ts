import type { Permission } from "../permission"

export interface OperationRef {
  type: "tool" | "command" | "shell" | "chat"
  name: string
  source?: "builtin" | "mcp" | "plugin" | "custom"
}

export interface PipelineContext {
  executionId: string
  operation: OperationRef
  session: { id: string; agent: string }
  args: unknown
  callChain: string[] // parent call IDs for session tracing
}

export interface PipelineResult<T = unknown> {
  data?: T
  shortCircuit?: boolean
  error?: { code: string; message: string }
  metadata?: Record<string, unknown>
}

export interface BeforeHook<Input = unknown> {
  name?: string
  priority?: number
  handle(input: Input, ctx: PipelineContext): Promise<PipelineResult<Input> | void>
}

export interface AfterHook<Input = unknown, Output = unknown> {
  name?: string
  priority?: number
  handle(input: Input, ctx: PipelineContext): Promise<PipelineResult<Output> | void>
}

export interface ErrorHook<Input = unknown> {
  name?: string
  priority?: number
  handle(input: Input, ctx: PipelineContext): Promise<void>
}

export class PipelineExecutor {
  static sortByPriority<T extends { priority?: number }>(hooks: T[]): T[] {
    return [...hooks].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))
  }

  static async dispatch<Input, Output>(
    operation: OperationRef,
    input: Input,
    options: {
      beforeHooks: BeforeHook<Input>[]
      afterHooks: AfterHook<Input, Output>[]
      errorHooks: ErrorHook<Input>[]
      execute: () => Promise<Output>
      session: { id: string; agent: string }
      callChain?: string[]
    },
  ): Promise<Output | undefined> {
    const ctx: PipelineContext = {
      executionId: crypto.randomUUID(),
      operation,
      session: options.session,
      args: input,
      callChain: options.callChain ?? [],
    }

    // Before hooks (priority sorted)
    for (const hook of this.sortByPriority(options.beforeHooks)) {
      try {
        const result = await hook.handle(input, ctx)
        if (result?.shortCircuit) return result.data as Output
        if (result?.error) {
          await this.runErrorHooks(options.errorHooks, ctx, result.error)
          return undefined
        }
        if (result?.data !== undefined) input = result.data
      } catch (err) {
        await this.runErrorHooks(options.errorHooks, ctx, {
          code: "HOOK_ERROR",
          message: err instanceof Error ? err.message : String(err),
        })
        return undefined
      }
    }

    // Execute
    let output: Output
    try {
      output = await options.execute()
    } catch (err) {
      await this.runErrorHooks(options.errorHooks, ctx, {
        code: "EXECUTION_ERROR",
        message: err instanceof Error ? err.message : String(err),
      })
      // Run after hooks even on error
      for (const hook of this.sortByPriority(options.afterHooks).reverse()) {
        try {
          await hook.handle(input, ctx)
        } catch {
          /* log and continue */
        }
      }
      return undefined
    }

    // After hooks
    for (const hook of this.sortByPriority(options.afterHooks)) {
      try {
        const result = await hook.handle(input, ctx)
        if (result?.data !== undefined) output = result.data as Output
      } catch {
        /* log and continue */
      }
    }

    return output
  }

  private static async runErrorHooks(hooks: ErrorHook[], ctx: PipelineContext, error: PipelineResult["error"]) {
    for (const hook of this.sortByPriority(hooks)) {
      try {
        await hook.handle(ctx.args, ctx)
      } catch {
        /* log and continue */
      }
    }
  }
}
