import { useRef, useState, useCallback, useEffect } from "react";
import type { ClientMessage, ServerMessage } from "@shared/types";

interface UseWebSocketReturn {
  connected: boolean;
  send: (message: ClientMessage) => void;
  lastMessage: ServerMessage | null;
  subscribe: (sessionID: string) => void;
  unsubscribe: (sessionID: string) => void;
}

const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;
const PING_INTERVAL = 30000;

export function useWebSocket(): UseWebSocketReturn {
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<ServerMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimeoutRef.current !== null) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const clearPingInterval = useCallback(() => {
    if (pingIntervalRef.current !== null) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
  }, []);

  const startPing = useCallback(() => {
    clearPingInterval();
    pingIntervalRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "ping" }));
      }
    }, PING_INTERVAL);
  }, [clearPingInterval]);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setConnected(true);
      reconnectAttemptRef.current = 0;
      startPing();
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);
      clearPingInterval();
      scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose will fire after onerror, so reconnect logic is handled there
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!mountedRef.current) return;
      try {
        const message: ServerMessage = JSON.parse(event.data as string);
        if (message.type === "pong") return;
        setLastMessage(message);
      } catch {
        // ignore malformed messages
      }
    };
  }, [startPing, clearPingInterval]);

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return;
    clearReconnectTimer();

    const delay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttemptRef.current),
      RECONNECT_MAX_DELAY,
    );
    reconnectAttemptRef.current += 1;

    reconnectTimeoutRef.current = setTimeout(() => {
      if (mountedRef.current) {
        connect();
      }
    }, delay);
  }, [connect, clearReconnectTimer]);

  const send = useCallback((message: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const subscribe = useCallback(
    (sessionID: string) => {
      send({ type: "subscribe", sessionID });
    },
    [send],
  );

  const unsubscribe = useCallback(
    (sessionID: string) => {
      send({ type: "unsubscribe", sessionID });
    },
    [send],
  );

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      clearReconnectTimer();
      clearPingInterval();
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, clearReconnectTimer, clearPingInterval]);

  return { connected, send, lastMessage, subscribe, unsubscribe };
}
