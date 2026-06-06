import React from "react";

interface HeaderProps {
  connected: boolean;
  sessionCount: number;
  busyCount: number;
}

export function Header({ connected, sessionCount, busyCount }: HeaderProps) {
  return (
    <header className="h-12 min-h-[48px] flex items-center justify-between px-4 border-b border-oc-border bg-oc-surface">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-semibold tracking-tight text-oc-text">
          OpenCode Observer
        </h1>
        <span className="text-xs text-oc-muted">
          {sessionCount} session{sessionCount !== 1 ? "s" : ""}
          {busyCount > 0 && (
            <span className="text-oc-green ml-1">
              ({busyCount} active)
            </span>
          )}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full ${
            connected ? "bg-oc-green" : "bg-oc-red"
          }`}
        />
        <span className="text-xs text-oc-muted">
          {connected ? "Connected" : "Disconnected"}
        </span>
      </div>
    </header>
  );
}
