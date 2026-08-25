import { Splash } from "@opencode-ai/ui/logo"

export function LoadingSplash(props: { deep: boolean }) {
  return (
    <div
      class="h-dvh w-screen flex flex-col items-center justify-center"
      classList={{
        "bg-v2-background-bg-deep": props.deep,
        "bg-v2-background-bg-base": !props.deep,
      }}
    >
      <Splash class="w-16 h-20 opacity-50 animate-pulse" />
    </div>
  )
}
