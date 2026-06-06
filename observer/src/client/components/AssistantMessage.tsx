import type {
  MessageWithParts,
  ActiveStream,
  Part,
  TextPart,
  ReasoningPart,
  ToolPart,
  SubtaskPart,
  StepFinishPart,
  AssistantMessage as AssistantMessageType,
} from "@shared/types";
import { TextContent } from "./TextContent";
import { ReasoningBlock } from "./ReasoningBlock";
import { ToolCallBlock } from "./ToolCallBlock";
import { SubAgentBlock } from "./SubAgentBlock";

interface AssistantMessageProps {
  message: MessageWithParts;
  activeStreams: ActiveStream[];
}

function formatCost(cost: number): string {
  if (cost === 0) return "";
  return `$${cost.toFixed(4)}`;
}

function formatTokens(count: number): string {
  if (count === 0) return "0";
  if (count < 1000) return String(count);
  if (count < 1000000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
}

function formatTime(timeMs: number): string {
  try {
    return new Date(timeMs).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function renderPart(
  part: Part,
  messageID: string,
  activeStreams: ActiveStream[],
): React.ReactNode {
  switch (part.type) {
    case "text":
      return (
        <TextContent
          key={part.id}
          part={part as TextPart}
          isStreaming={activeStreams.some(
            (s) =>
              s.messageID === messageID &&
              s.partID === part.id &&
              s.type === "text",
          )}
        />
      );
    case "reasoning":
      return (
        <ReasoningBlock
          key={part.id}
          part={part as ReasoningPart}
          isStreaming={activeStreams.some(
            (s) =>
              s.messageID === messageID &&
              s.partID === part.id &&
              s.type === "reasoning",
          )}
        />
      );
    case "tool":
      return <ToolCallBlock key={part.id} part={part as ToolPart} />;
    case "subtask":
      return <SubAgentBlock key={part.id} part={part as SubtaskPart} />;
    case "step-start":
      return null;
    case "step-finish": {
      const sf = part as StepFinishPart;
      const costStr = formatCost(sf.cost);
      const tokenStr = `${formatTokens(sf.tokens.input)} in / ${formatTokens(sf.tokens.output)} out`;
      return (
        <div
          key={part.id}
          className="text-xs text-oc-muted mt-1 mb-2 flex items-center gap-2"
        >
          {costStr && <span>{costStr}</span>}
          <span>{tokenStr}</span>
        </div>
      );
    }
    case "agent":
      return null;
    case "compaction":
      return (
        <div
          key={part.id}
          className="text-xs text-oc-muted italic my-1 px-3 py-1 bg-oc-surface rounded border border-oc-border"
        >
          Context compressed: {part.summary ?? "(no summary)"}
        </div>
      );
    default:
      return null;
  }
}

export function AssistantMessage({ message, activeStreams }: AssistantMessageProps) {
  const info = message.info as AssistantMessageType;

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="flex items-center justify-center w-5 h-5 rounded bg-oc-purple/20 text-oc-purple text-xs">
          A
        </span>
        <span className="text-xs font-medium text-oc-purple">
          {info.agent || "Assistant"}
        </span>
        {info.modelID && (
          <span className="text-xs text-oc-muted">
            {info.providerID}/{info.modelID}
          </span>
        )}
        <span className="text-xs text-oc-muted">
          {formatTime(info.time.created)}
        </span>
      </div>
      <div className="pl-7">
        {message.parts.map((part) => renderPart(part, info.id, activeStreams))}
        {info.error && (
          <div className="mt-2 px-3 py-2 bg-oc-red/10 border border-oc-red/30 rounded text-sm text-oc-red">
            Error: {info.error.data.message}
          </div>
        )}
      </div>
    </div>
  );
}
