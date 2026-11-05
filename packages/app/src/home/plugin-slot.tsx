import { PluginSlot } from "@/runtime/plugin/render"

/** Plugin content in Home's main column; it takes no room while no contribution renders anything. */
export function HomePluginSlot(props: { server: string; directory: string | undefined }) {
  return (
    <div class="flex flex-col gap-2 py-2 empty:hidden md:py-1">
      <PluginSlot
        at="home.main"
        input={{
          get server() {
            return props.server
          },
          get directory() {
            return props.directory
          },
        }}
      />
    </div>
  )
}
