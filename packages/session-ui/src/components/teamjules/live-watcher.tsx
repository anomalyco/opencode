import { createSignal, Show, type JSX } from "solid-js";
import { Button } from "@opencode-ai/ui/button";

export function TeamJulesLiveWatcher(props: { taskId: string }): JSX.Element {
  const [status, setStatus] = createSignal<"idle" | "loading" | "ready" | "error">("idle");
  const [inviteUrl, setInviteUrl] = createSignal<string | null>(null);
  const [errorMsg, setErrorMsg] = createSignal<string>("");

  const handleConnect = async () => {
    setStatus("loading");
    try {
      // In a real OpenCode environment, this would use the @opencode-ai/sdk client
      // e.g. await client.teamjules.getMeshCapability({ taskId: props.taskId })
      const res = await fetch(`/api/v1/tasks/${props.taskId}/mesh-capability`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to fetch GitPigeon mesh capability.");
      }
      
      const data = await res.json();
      setInviteUrl(data.pigeonInviteUrl);
      setStatus("ready");
    } catch (e: any) {
      setErrorMsg(e.message || "An unexpected error occurred.");
      setStatus("error");
    }
  };

  const copyCommand = async () => {
    const url = inviteUrl();
    if (url) {
      await navigator.clipboard.writeText(`git pigeon init '${url}' my-agent-task`);
    }
  };

  return (
    <div class="flex flex-col gap-3 p-3 mt-4 border rounded-md bg-surface-base border-border-base">
      <div class="flex items-center justify-between">
        <div class="flex flex-col">
          <span class="text-13-semibold text-text-strong">Live Workspace</span>
          <span class="text-12-regular text-text-weak">P2P GitPigeon Sync</span>
        </div>
        
        <Show when={status() === "idle"}>
          <Button size="small" variant="secondary" onClick={handleConnect}>
            Watch Live
          </Button>
        </Show>

        <Show when={status() === "loading"}>
          <span class="text-12-medium text-text-weak animate-pulse">Loading...</span>
        </Show>
      </div>

      <Show when={status() === "error"}>
        <div class="text-12-medium text-text-danger bg-surface-danger p-2 rounded">
          {errorMsg()}
        </div>
      </Show>

      <Show when={status() === "ready" && inviteUrl()}>
        <div class="flex flex-col gap-2 mt-1">
          <span class="text-12-medium text-text-base">Run this locally to sync:</span>
          <div class="relative flex items-center bg-surface-raised-base border border-border-base rounded p-2 overflow-x-auto">
            <code class="text-11-regular text-text-strong whitespace-nowrap pr-8">
              git pigeon init '{inviteUrl()}'
            </code>
            <button 
              onClick={copyCommand}
              class="absolute right-1 top-1/2 -translate-y-1/2 p-1 bg-surface-raised-base hover:bg-surface-raised-base-hover rounded text-text-weak hover:text-text-strong"
              title="Copy to clipboard"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}
