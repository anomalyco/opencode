import { Provider } from "@/provider/provider";
import { type ModelMessage, type StreamTextResult, type Tool, type ToolSet } from "ai";
import type { Agent } from "@/agent/agent";
import type { MessageV2 } from "./message-v2";
export declare namespace LLM {
    const OUTPUT_TOKEN_MAX: any;
    type StreamInput = {
        user: MessageV2.User;
        sessionID: string;
        model: Provider.Model;
        agent: Agent.Info;
        system: string[];
        abort: AbortSignal;
        messages: ModelMessage[];
        small?: boolean;
        tools: Record<string, Tool>;
        retries?: number;
        toolChoice?: "auto" | "required" | "none";
    };
    type StreamOutput = StreamTextResult<ToolSet, unknown>;
    function stream(input: StreamInput): Promise<StreamTextResult<Record<string, Tool>, never>>;
    function hasToolCalls(messages: ModelMessage[]): boolean;
}
