import type { MessageWithParts, UserMessage as UserMessageType } from "@shared/types";

interface UserMessageProps {
  message: MessageWithParts;
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

export function UserMessage({ message }: UserMessageProps) {
  const info = message.info as UserMessageType;

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="flex items-center justify-center w-5 h-5 rounded bg-oc-accent/20 text-oc-accent text-xs">
          U
        </span>
        <span className="text-xs font-medium text-oc-accent">You</span>
        <span className="text-xs text-oc-muted">
          {formatTime(info.time.created)}
        </span>
      </div>
      <div className="pl-7">
        {info.text && (
          <div className="text-sm text-oc-text whitespace-pre-wrap">
            {info.text}
          </div>
        )}
        {info.files && info.files.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {info.files.map((file, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 text-xs bg-oc-surface border border-oc-border rounded px-2 py-0.5 text-oc-muted"
              >
                📎 {file.name}
              </span>
            ))}
          </div>
        )}
        {info.agents && info.agents.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {info.agents.map((agent, i) => (
              <span
                key={i}
                className="inline-flex items-center text-xs text-oc-accent"
              >
                🤖 {agent}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
