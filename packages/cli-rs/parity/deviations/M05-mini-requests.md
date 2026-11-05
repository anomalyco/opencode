# M05: mini's footer views

## The permission scrollbar does not follow the scroll

- TypeScript: the scrollbar shows always; its thumb fills the track when the request fits and shrinks and moves
  when it scrolls.
- Rust: the column shows a full-height thumb always.
- Reason: a permission's content fits its footer in every case the scenarios and the live service showed. The
  form body, whose content does overflow, uses the scroll box's own scrollbar, which shows only on overflow as
  TypeScript's form does.

## No subagent views

- TypeScript: the footer tracks child sessions (`stream-v2.subagent.ts`): the `N subagents` and `bg` hints,
  `session.child.first` and its panel, the subagent inspector, `composer.subagent.interrupt`,
  `session.background`, "View subagents" in the command menu, and the permissions and forms of descendant
  sessions.
- Rust: none of these. A child session's permission or form does not show in mini.
- Reason: mini's transcript drops the events of other sessions, and the subagent stream is a port of its own.
  It is a follow-up.

## No global forms

- TypeScript: MCP elicitations without a session (`sessionID: "global"`) of the session's location show after
  the session's own forms.
- Rust: only the session's forms show.
- Reason: mini's transcript drops events of other owners; the global forms come with the subagent stream's
  routing.

## No mouse in the footer

- TypeScript: hovering a permission button or a form row selects it, and a click picks it.
- Rust: keys only.
- Reason: mini runs with mouse tracking off (M.1), so the footer never sees the pointer.
