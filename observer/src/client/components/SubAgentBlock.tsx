import type { SubtaskPart } from "@shared/types";

interface SubAgentBlockProps {
  part: SubtaskPart;
}

function SubAgentStatusIcon({ status }: { status: SubtaskPart["status"] }) {
  switch (status) {
    case "pending":
      return (
        <span className="w-2 h-2 rounded-full border border-oc-muted" />
      );
    case "running":
      return (
        <svg
          className="w-3 h-3 text-oc-accent animate-spin-slow"
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
          className="w-3 h-3 text-oc-green"
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
          className="w-3 h-3 text-oc-red"
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
    case undefined:
      return (
        <span className="w-2 h-2 rounded-full border border-oc-muted" />
      );
  }
}

export function SubAgentBlock({ part }: SubAgentBlockProps) {
  const statusLabel = part.status ?? "pending";

  return (
    <div className="my-2 ml-4 border-l-2 border-oc-border pl-3">
      <div className="flex items-center gap-2">
        <SubAgentStatusIcon status={part.status} />
        <span className="text-sm font-medium text-oc-text">
          🤖 {part.agent}
        </span>
        <span className="text-xs text-oc-muted capitalize">{statusLabel}</span>
      </div>
      {part.description && (
        <p className="mt-1 text-xs text-oc-muted">{part.description}</p>
      )}
    </div>
  );
}
