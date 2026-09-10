import type {
  AgentEvent,
  AgentOptions,
  ApprovalHandler,
  AssistantMessage,
  ConversationMessage,
  ToolMessage,
  UserMessage,
} from "./types.ts";

const DEFAULT_MAX_TURNS = 24;

export const DEFAULT_SYSTEM_PROMPT = [
  "You are OpenCode ARM, a coding agent running as a native Windows-on-ARM64 desktop app.",
  "You help the user with software engineering tasks inside their workspace.",
  "Use the provided tools to read, search, create, and edit files, and to run commands.",
  "Prefer relative paths inside the workspace. Read before you edit. Keep edits minimal and precise.",
  "When you finish a task, summarize what changed and how to verify it.",
].join("\n");

export class Agent {
  private readonly provider: AgentOptions["provider"];
  private readonly tools: AgentOptions["tools"];
  private readonly system: string;
  private readonly maxTurns: number;
  private readonly approval: ApprovalHandler;
  private history: ConversationMessage[] = [];
  private controller: AbortController | null = null;

  constructor(options: AgentOptions) {
    this.provider = options.provider;
    this.tools = options.tools;
    this.system = options.system;
    this.maxTurns = Math.max(1, options.maxTurns ?? DEFAULT_MAX_TURNS);
    const provided = options.approval;
    this.approval = provided ?? (async () => false);
    if (options.signal) {
      options.signal.addEventListener("abort", () => this.abort(), { once: true });
    }
  }

  get messages(): readonly ConversationMessage[] {
    return this.history;
  }

  reset(): void {
    this.abort();
    this.history = [];
  }

  abort(): void {
    this.controller?.abort();
  }

  async *run(input: string): AsyncGenerator<AgentEvent> {
    if (input.trim().length === 0) {
      yield { kind: "done", stopReason: "end_turn" };
      return;
    }
    const userMessage: UserMessage = { role: "user", text: input };
    this.history.push(userMessage);

    this.controller = new AbortController();
    const signal = this.controller.signal;

    try {
      for (let turn = 1; turn <= this.maxTurns; turn++) {
        yield { kind: "turn_start", turn };

        let text = "";
        let streamed: AssistantMessage | null = null;
        for await (const ev of this.provider.stream({
          messages: [...this.history],
          system: this.system,
          tools: this.tools.specs(),
          signal,
        })) {
          if (ev.kind === "text_delta") {
            text += ev.text;
            yield ev;
          } else if (ev.kind === "usage") {
            yield ev;
          } else if (ev.kind === "message") {
            streamed = ev.message;
          }
        }

        const assistant: AssistantMessage =
          streamed ?? { role: "assistant", text, toolCalls: [] };
        this.history.push(assistant);
        yield { kind: "assistant_message", message: assistant };

        if (assistant.toolCalls.length === 0) {
          yield { kind: "done", stopReason: "end_turn" };
          return;
        }

        for (const call of assistant.toolCalls) {
          yield { kind: "tool_start", call };
          const startedAt = Date.now();
          const result = await this.tools.invoke(call, {
            approval: this.approval,
          });
          const toolMessage: ToolMessage = {
            role: "tool",
            callId: call.id,
            name: call.name,
            output: result.output,
            isError: result.isError,
          };
          this.history.push(toolMessage);
          yield {
            kind: "tool_end",
            callId: call.id,
            name: call.name,
            output: result.output,
            isError: result.isError,
            durationMs: Date.now() - startedAt,
          };
        }
      }
      yield { kind: "done", stopReason: "max_turns" };
    } catch (err) {
      if (signal.aborted || isAbortError(err)) {
        yield { kind: "done", stopReason: "aborted" };
        return;
      }
      yield {
        kind: "done",
        stopReason: "provider_error",
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      this.controller = null;
    }
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}
