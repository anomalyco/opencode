// Zed editor context (P08): in a Zed terminal with no IDE server, the TUI reads the active editor and its selections
// from Zed's database, here a temporary one whose only workspace is `/`. The byte range 18..29 runs from line 2 into
// line 3, and an `index.*` file shows with its directory.
import { defineApp, session, user } from "../../lib/app"

const deviation = ["V01-plain-transcript", "P01-read-only-prompt"]
const contents = "const a = 1\nconst b = 2\nconst c = 3\n"

export default defineApp({
  args: { sessionID: "ses_b" },
  config: { experimental: { "new-designs": true } },
  zed: {
    sql: `create table workspaces (workspace_id integer, paths text, timestamp text);
create table panes (pane_id integer, workspace_id integer, active integer);
create table items (item_id integer, workspace_id integer, pane_id integer, kind text, active integer);
create table editors (item_id integer, workspace_id integer, buffer_path text, contents text);
create table editor_selections (editor_id integer, workspace_id integer, start integer, end integer);
insert into workspaces values (1, '["/"]', '2026-11-04 10:00:00');
insert into panes values (1, 1, 1);
insert into items values (7, 1, 1, 'Editor', 1);
insert into editors values (7, 1, '/tmp/opencode/packages/tui/src/index.ts', '${contents}');
insert into editor_selections values (7, 1, 18, 29);`,
  },
  routes: [
    { path: "/api/session/ses_b", json: { data: session("ses_b", "Fix the parser", { updated: 2 }) } },
    { path: "/api/session/ses_b/message", json: { data: [user("msg_1", "Why does the parser fail?")], cursor: {} } },
    { path: "/api/session/ses_b/inbox", json: { data: [] } },
  ],
  steps: [{ checkpoint: "selected", until: "src/index.ts#2-3", deviation }],
})
