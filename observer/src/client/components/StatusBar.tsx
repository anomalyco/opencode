import type { SessionInfo, SessionStatus } from "@shared/types";

interface StatusBarProps {
  session: SessionInfo;
  status: SessionStatus | null;
}

function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function formatTokens(count: number): string {
  if (count === 0) return "0";
  if (count < 1000) return String(count);
  if (count < 1000000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
}

export function StatusBar({ session, status }: StatusBarProps) {
  const cost = session.cost ?? 0;
  const tokens = session.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };

  return (
    <div className="h-7 min-h-[28px] flex items-center justify-between px-4 border-t border-oc-border bg-oc-surface text-xs text-oc-muted">
      <div className="flex items-center gap-4">
        <span>Cost: {formatCost(cost)}</span>
        <span>
          Tokens: {formatTokens(tokens.input)} in / {formatTokens(tokens.output)} out
          {tokens.reasoning > 0 && ` / ${formatTokens(tokens.reasoning)} reasoning`}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {status?.type === "busy" && (
          <span className="flex items-center gap-1 text-oc-green">
            <span className="w-1.5 h-1.5 rounded-full bg-oc-green animate-pulse-dot" />
            Running
          </span>
        )}
        {status?.type === "retry" && (
          <span className="flex items-center gap-1 text-oc-yellow">
            Retrying (attempt {status.attempt})
          </span>
        )}
        {status?.type === "idle" && <span>Idle</span>}
      </div>
    </div>
  );
}
