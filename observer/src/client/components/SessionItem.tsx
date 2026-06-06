import type { SessionInfo, SessionStatus } from "@shared/types";

interface SessionItemProps {
  session: SessionInfo;
  status: SessionStatus;
  selected: boolean;
  onClick: () => void;
}

function formatRelativeTime(timeMs: number): string {
  const now = Date.now();
  const diffMs = now - timeMs;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(timeMs).toLocaleDateString();
}

function StatusDot({ status }: { status: SessionStatus }) {
  if (status.type === "busy") {
    return <span className="w-2 h-2 rounded-full bg-oc-green animate-pulse-dot flex-shrink-0" />;
  }
  if (status.type === "retry") {
    return <span className="w-2 h-2 rounded-full bg-oc-yellow flex-shrink-0" />;
  }
  return <span className="w-2 h-2 rounded-full bg-oc-muted flex-shrink-0" />;
}

export function SessionItem({ session, status, selected, onClick }: SessionItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 border-b border-oc-border transition-colors ${
        selected
          ? "bg-oc-accent/10 border-l-2 border-l-oc-accent"
          : "hover:bg-oc-bg border-l-2 border-l-transparent"
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="mt-1.5">
          <StatusDot status={status} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-oc-text truncate">
            {session.title || session.id}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {session.agent && (
              <span className="text-xs text-oc-accent">{session.agent}</span>
            )}
            <span className="text-xs text-oc-muted">
              {formatRelativeTime(session.time.updated)}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
