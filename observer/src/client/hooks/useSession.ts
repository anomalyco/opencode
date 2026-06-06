import { useState, useCallback, useEffect, useRef } from "react";
import type {
  SessionInfo,
  SessionStatus,
  MessageWithParts,
  Part,
  TextPart,
  ReasoningPart,
  ServerMessage,
  ActiveStream,
} from "@shared/types";

interface UseSessionReturn {
  sessions: SessionInfo[];
  sessionStatuses: Record<string, SessionStatus>;
  selectedSessionID: string | null;
  selectSession: (id: string | null) => void;
  messages: MessageWithParts[];
  activeStreams: ActiveStream[];
}

export function useSession(
  connected: boolean,
  lastMessage: ServerMessage | null,
  subscribe: (sessionID: string) => void,
  unsubscribe: (sessionID: string) => void,
): UseSessionReturn {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionStatuses, setSessionStatuses] = useState<Record<string, SessionStatus>>({});
  const [selectedSessionID, setSelectedSessionID] = useState<string | null>(null);
  const [messagesMap, setMessagesMap] = useState<Record<string, MessageWithParts[]>>({});
  const [activeStreams, setActiveStreams] = useState<ActiveStream[]>([]);
  const prevSelectedRef = useRef<string | null>(null);

  const selectSession = useCallback(
    (id: string | null) => {
      if (prevSelectedRef.current && prevSelectedRef.current !== id) {
        unsubscribe(prevSelectedRef.current);
      }
      setSelectedSessionID(id);
      prevSelectedRef.current = id;
      if (id && connected) {
        subscribe(id);
      }
    },
    [connected, subscribe, unsubscribe],
  );

  // Update a part within a message
  const updatePartInMessage = useCallback(
    (sessionID: string, updatedPart: Part) => {
      setMessagesMap((prev) => {
        const msgs = prev[sessionID];
        if (!msgs) return prev;
        return {
          ...prev,
          [sessionID]: msgs.map((msg) => {
            const hasPart = msg.parts.some((p) => p.id === updatedPart.id);
            if (!hasPart) return msg;
            return {
              ...msg,
              parts: msg.parts.map((p) =>
                p.id === updatedPart.id ? updatedPart : p,
              ),
            };
          }),
        };
      });
    },
    [],
  );

  // Apply text delta to a specific part
  const applyTextDelta = useCallback(
    (sessionID: string, messageID: string, partID: string, delta: string) => {
      setMessagesMap((prev) => {
        const msgs = prev[sessionID];
        if (!msgs) return prev;
        return {
          ...prev,
          [sessionID]: msgs.map((msg) => {
            if (msg.info.id !== messageID) return msg;
            return {
              ...msg,
              parts: msg.parts.map((p) => {
                if (p.id !== partID) return p;
                if (p.type === "text") {
                  return { ...p, text: (p as TextPart).text + delta } as TextPart;
                }
                if (p.type === "reasoning") {
                  return { ...p, text: (p as ReasoningPart).text + delta } as ReasoningPart;
                }
                return p;
              }),
            };
          }),
        };
      });
    },
    [],
  );

  // Process incoming WebSocket messages
  useEffect(() => {
    if (!lastMessage) return;

    switch (lastMessage.type) {
      case "session.list": {
        setSessions(lastMessage.sessions);
        break;
      }
      case "session.status": {
        setSessionStatuses((prev) => ({
          ...prev,
          [lastMessage.sessionID]: lastMessage.status,
        }));
        break;
      }
      case "session.messages": {
        setMessagesMap((prev) => ({
          ...prev,
          [lastMessage.sessionID]: lastMessage.messages,
        }));
        setActiveStreams((prev) =>
          prev.filter((s) => s.sessionID !== lastMessage.sessionID),
        );
        break;
      }
      case "message.updated": {
        const { sessionID, message } = lastMessage;
        setMessagesMap((prev) => {
          const existing = prev[sessionID] ?? [];
          const idx = existing.findIndex((m) => m.info.id === message.info.id);
          if (idx >= 0) {
            const updated = [...existing];
            updated[idx] = message;
            return { ...prev, [sessionID]: updated };
          }
          return { ...prev, [sessionID]: [...existing, message] };
        });
        break;
      }
      case "part.updated": {
        updatePartInMessage(lastMessage.sessionID, lastMessage.part);
        break;
      }
      case "text.delta": {
        const { sessionID, messageID, partID, delta } = lastMessage;
        applyTextDelta(sessionID, messageID, partID, delta);
        setActiveStreams((prev) => {
          const exists = prev.some(
            (s) =>
              s.sessionID === sessionID &&
              s.messageID === messageID &&
              s.partID === partID,
          );
          if (exists) return prev;
          return [...prev, { sessionID, messageID, partID, type: "text" }];
        });
        break;
      }
      case "reasoning.delta": {
        const { sessionID, messageID, partID, delta } = lastMessage;
        applyTextDelta(sessionID, messageID, partID, delta);
        setActiveStreams((prev) => {
          const exists = prev.some(
            (s) =>
              s.sessionID === sessionID &&
              s.messageID === messageID &&
              s.partID === partID,
          );
          if (exists) return prev;
          return [...prev, { sessionID, messageID, partID, type: "reasoning" }];
        });
        break;
      }
      case "tool.progress": {
        updatePartInMessage(lastMessage.sessionID, lastMessage.part);
        break;
      }
      case "step.started":
      case "step.ended":
      case "connected":
      case "pong":
      case "error":
        break;
    }
  }, [lastMessage, updatePartInMessage, applyTextDelta]);

  // Subscribe to selected session when connection is established
  useEffect(() => {
    if (connected && selectedSessionID) {
      subscribe(selectedSessionID);
    }
  }, [connected, selectedSessionID, subscribe]);

  // Clean up active streams when a session is no longer busy
  useEffect(() => {
    setActiveStreams((prev) =>
      prev.filter((s) => {
        const status = sessionStatuses[s.sessionID];
        return status?.type !== "idle";
      }),
    );
  }, [sessionStatuses]);

  const messages = selectedSessionID ? (messagesMap[selectedSessionID] ?? []) : [];

  return {
    sessions,
    sessionStatuses,
    selectedSessionID,
    selectSession,
    messages,
    activeStreams,
  };
}
