import { useState } from "react";
import type { ReasoningPart } from "@shared/types";

interface ReasoningBlockProps {
  part: ReasoningPart;
  isStreaming: boolean;
}

export function ReasoningBlock({ part, isStreaming }: ReasoningBlockProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="my-2 border border-oc-border rounded-md bg-oc-bg/50 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-oc-muted hover:text-oc-text transition-colors"
      >
        <svg
          className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
        <span className="italic">
          {isStreaming ? "Thinking..." : "Reasoning"}
        </span>
      </button>
      {expanded && (
        <div className="px-3 pb-2">
          <div
            className={`text-sm text-oc-muted italic whitespace-pre-wrap ${
              isStreaming ? "streaming-cursor" : ""
            }`}
          >
            {part.text || (isStreaming ? "" : "(empty)")}
          </div>
        </div>
      )}
    </div>
  );
}
