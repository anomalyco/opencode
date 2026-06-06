import { useState, useMemo } from "react";
import type { SessionInfo, SessionStatus } from "@shared/types";
import { SessionItem } from "./SessionItem";

interface SessionListProps {
  sessions: SessionInfo[];
  sessionStatuses: Record<string, SessionStatus>;
  selectedSessionID: string | null;
  onSelectSession: (id: string | null) => void;
}

export function SessionList({
  sessions,
  sessionStatuses,
  selectedSessionID,
  onSelectSession,
}: SessionListProps) {
  const [search, setSearch] = useState("");

  const sortedSessions = useMemo(() => {
    const filtered = sessions.filter((s) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        s.title.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        (s.agent?.toLowerCase().includes(q) ?? false)
      );
    });

    return filtered.sort((a, b) => {
      // Busy sessions first
      const aBusy = sessionStatuses[a.id]?.type === "busy" ? 1 : 0;
      const bBusy = sessionStatuses[b.id]?.type === "busy" ? 1 : 0;
      if (aBusy !== bBusy) return bBusy - aBusy;
      // Then by most recently updated
      return new Date(b.time.updated).getTime() - new Date(a.time.updated).getTime();
    });
  }, [sessions, sessionStatuses, search]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-oc-border">
        <input
          type="text"
          placeholder="Search sessions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-1.5 text-sm bg-oc-bg border border-oc-border rounded-md text-oc-text placeholder-oc-muted focus:outline-none focus:border-oc-accent"
        />
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {sortedSessions.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-oc-muted">
            {sessions.length === 0
              ? "No sessions available"
              : "No matching sessions"}
          </div>
        ) : (
          sortedSessions.map((session) => (
            <SessionItem
              key={session.id}
              session={session}
              status={sessionStatuses[session.id] ?? { type: "idle" }}
              selected={session.id === selectedSessionID}
              onClick={() => onSelectSession(session.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
