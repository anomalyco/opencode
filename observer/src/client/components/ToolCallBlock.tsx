import { useState, useCallback } from "react";
import type { ToolPart, ToolState } from "@shared/types";

interface ToolCallBlockProps {
  part: ToolPart;
}

function StatusIcon({ status }: { status: ToolState["status"] }) {
  switch (status) {
    case "pending":
      return (
        <span className="w-3.5 h-3.5 rounded-full border border-oc-muted flex items-center justify-center">
          <span className="w-1 h-1 rounded-full bg-oc-muted" />
        </span>
      );
    case "running":
      return (
        <svg
          className="w-3.5 h-3.5 text-oc-accent animate-spin-slow"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      );
    case "completed":
      return (
        <svg
          className="w-3.5 h-3.5 text-oc-green"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
      );
    case "error":
      return (
        <svg
          className="w-3.5 h-3.5 text-oc-red"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      );
  }
}

function formatDuration(startMs: number, endMs?: number): string {
  const endTime = endMs ?? Date.now();
  const diffMs = endTime - startMs;
  if (diffMs < 1000) return `${diffMs}ms`;
  if (diffMs < 60000) return `${(diffMs / 1000).toFixed(1)}s`;
  return `${Math.floor(diffMs / 60000)}m ${Math.floor((diffMs % 60000) / 1000)}s`;
}

function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-oc-muted hover:text-oc-text transition-colors"
      >
        <svg
          className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`}
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
        {title}
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  );
}

function JsonView({ data }: { data: Record<string, unknown> }) {
  const formatted = JSON.stringify(data, null, 2);
  return (
    <pre className="text-xs bg-oc-bg rounded p-2 overflow-x-auto max-h-60 scrollbar-thin text-oc-muted">
      {formatted}
    </pre>
  );
}

export function ToolCallBlock({ part }: ToolCallBlockProps) {
  const { tool, state } = part;

  const title = useCallback(() => {
    if (state.status === "completed" && state.title) {
      return state.title;
    }
    if (state.status === "running" && state.title) {
      return state.title;
    }
    return tool;
  }, [tool, state])();

  const inputObj =
    state.status === "pending"
      ? (state as ToolState & { status: "pending" }).input
      : state.input;

  return (
    <div className="my-2 border border-oc-border rounded-md bg-oc-bg/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-oc-surface/50">
        <StatusIcon status={state.status} />
        <span className="text-sm font-medium text-oc-text">{title}</span>
        {state.status === "running" && (
          <span className="text-xs text-oc-muted ml-auto">
            {formatDuration(state.time.start)}
          </span>
        )}
        {(state.status === "completed" || state.status === "error") && (
          <span className="text-xs text-oc-muted ml-auto">
            {formatDuration(state.time.start, state.time.end)}
          </span>
        )}
      </div>

      {/* Input */}
      {inputObj && Object.keys(inputObj).length > 0 && (
        <div className="px-3 py-1.5 border-t border-oc-border">
          <CollapsibleSection title="Input" defaultOpen={false}>
            <JsonView data={inputObj} />
          </CollapsibleSection>
        </div>
      )}

      {/* Output */}
      {state.status === "completed" && (
        <div className="px-3 py-1.5 border-t border-oc-border">
          <CollapsibleSection title="Output" defaultOpen={false}>
            <pre className="text-xs bg-oc-bg rounded p-2 overflow-x-auto max-h-60 scrollbar-thin text-oc-text whitespace-pre-wrap">
              {state.output}
            </pre>
          </CollapsibleSection>
        </div>
      )}

      {/* Error */}
      {state.status === "error" && (
        <div className="px-3 py-1.5 border-t border-oc-border">
          <div className="text-xs text-oc-red bg-oc-red/5 rounded p-2">
            {state.error}
          </div>
        </div>
      )}
    </div>
  );
}
