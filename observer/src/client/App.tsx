import { useWebSocket } from "./hooks/useWebSocket";
import { useSession } from "./hooks/useSession";
import { Header } from "./components/Header";
import { SessionList } from "./components/SessionList";
import { SessionView } from "./components/SessionView";

export default function App() {
  const { connected, lastMessage, subscribe, unsubscribe } = useWebSocket();
  const {
    sessions,
    sessionStatuses,
    selectedSessionID,
    selectSession,
    messages,
    activeStreams,
  } = useSession(connected, lastMessage, subscribe, unsubscribe);

  const selectedSession = sessions.find((s) => s.id === selectedSessionID) ?? null;
  const selectedStatus = selectedSessionID
    ? sessionStatuses[selectedSessionID] ?? { type: "idle" as const }
    : null;

  return (
    <div className="flex flex-col h-screen bg-oc-bg text-oc-text">
      <Header
        connected={connected}
        sessionCount={sessions.length}
        busyCount={Object.values(sessionStatuses).filter((s) => s.type === "busy").length}
      />
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-[280px] min-w-[280px] border-r border-oc-border flex flex-col bg-oc-surface">
          <SessionList
            sessions={sessions}
            sessionStatuses={sessionStatuses}
            selectedSessionID={selectedSessionID}
            onSelectSession={selectSession}
          />
        </aside>
        <main className="flex-1 flex flex-col overflow-hidden">
          <SessionView
            session={selectedSession}
            status={selectedStatus}
            messages={messages}
            activeStreams={activeStreams}
          />
        </main>
      </div>
    </div>
  );
}
