import { useRouteData } from "@tui/context/route";
import { useSync } from "@tui/context/sync";
import { createMemo, createSignal, Show } from "solid-js";
import { useTheme } from "@tui/context/theme";
import { useTerminalDimensions } from "@opentui/solid";
import { FileList } from "./file-list";

export function Changes() {
  const route = useRouteData("changes");
  const sync = useSync();
  const { theme } = useTheme();
  const dimensions = useTerminalDimensions();

  const files = createMemo(() => sync.data.session_diff[route.sessionID] ?? []);
  const [selected, setSelected] = createSignal(0);
  const [pane, setPane] = createSignal<"list" | "diff">("list");

  const sidebar = 40;
  const width = createMemo(
    () => dimensions().width - (pane() === "list" ? sidebar + 1 : 1),
  );

  return (
    <box
      flexDirection="column"
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={theme.background}
    >
      <box flexGrow={1} flexDirection="row">
        <Show when={pane() === "list"}>
          <FileList
            files={files()}
            selected={selected()}
            onSelect={setSelected}
            onSwitch={() => setPane("diff")}
            width={sidebar}
            focused={pane() === "list"}
          />
        </Show>
        <Show
          when={files().length > 0}
          fallback={
            <box width={width()} height="100%" paddingLeft={2} paddingTop={2}>
              <text fg={theme.textMuted}>No changes to display</text>
            </box>
          }
        >
          <scrollbox
            flexGrow={1}
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
          >
            {/*
						 *div goes here
						 */}
          </scrollbox>
        </Show>
      </box>
    </box>
  );
}
