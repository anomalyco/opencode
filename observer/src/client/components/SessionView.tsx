import type { SessionInfo, SessionStatus, MessageWithParts, ActiveStream } from "@shared/types";
import { MessageList } from "./MessageList";
import { StatusBar } from "./StatusBar";

interface SessionViewProps {
  session: SessionInfo | null;
  status: SessionStatus | null;
  messages: MessageWithParts[];
  activeStreams: ActiveStream[];
}

function StatusBadge({ status }: { status: SessionStatus }) {
  if (status.type === "busy") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-oc-green">
        <span className="w-1.5 h-1.5 rounded-full bg-oc-green animate-pulse-dot" />
        Busy
      </span>
    );
  }
  if (status.type === "retry") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-oc-yellow">
        <span className="w-1.5 h-1.5 rounded-full bg-oc-yellow" />
        Retry (attempt {status.attempt})
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-oc-muted">
      <span className="w-1.5 h-1.5 rounded-full bg-oc-muted" />
      Idle
    </span>
  );
}

export function SessionView({
  session,
  status,
  messages,
  activeStreams,
}: SessionViewProps) {
  if (!session) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-3 opacity-20">💬</div>
          <p className="text-oc-muted text-sm">
            Select a session to view its messages
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Session header */}
      <div className="px-4 py-3 border-b border-oc-border bg-oc-surface">
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-oc-text truncate">
              {session.title || session.id}
            </h2>
            <div className="flex items-center gap-3 mt-1">
              {session.agent && (
                <span className="text-xs text-oc-accent">{session.agent}</span>
              )}
              {session.model && (
                <span className="text-xs text-oc-muted">
                  {session.model.providerID}/{session.model.id}
                </span>
              )}
              {status && <StatusBadge status={status} />}
            </div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <MessageList messages={messages} activeStreams={activeStreams} />

      {/* Status bar */}
      <StatusBar session={session} status={status} />
    </div>
  );
}
