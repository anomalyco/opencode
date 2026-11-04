# V15: scroll distances, unsaved group state, and session.first without a head window

E.8's scrolling, navigation, and groups match the TypeScript cells where both show the same rows
(`E.8/navigate`: `open`, `first`, `last`, `last-user`, and the "Jump to latest" row; zero differing cells
after the V01 layout shift). Four differences remain.

1. Scroll distances. TypeScript pages by half the transcript's height and half-pages by a quarter of it
   (`routes/session/index.tsx:929-969`). Rust does the same, but T.1's session layout (V01 part 1) makes the
   transcript four rows shorter at the same terminal size: 17 rows instead of 21 at 100x30. So a page up moves
   8 rows in Rust and 10 in TypeScript, and the `page-up` checkpoint shows different rows. Reason: not built
   yet; the distance follows once the session header step removes the extra rows.
2. Open and closed groups live as long as the session view. TypeScript keeps them per session tab
   (`sessionTabs.groupExpanded`, `context/session-tabs.tsx`) and saves the scroll anchor there too, so a tab
   reopens where it was. Reason: the session tabs (Track W) are not built yet.
3. `session.first` mounts every loaded row. TypeScript mounts the first 60 rows (`setVisibleRowsEnd`) and
   mounts newer ones as the reader scrolls down (`revealNewerRows`). Rust's window (E.6a) only trims older
   rows, so after `session.first` a long session has every row mounted until `session.last` or a scroll back
   to the bottom returns to the tail. The screen is the same. Reason: an end window is a second windowing
   mode in `messages/list.rs`; it can come when a long session shows a cost.
4. `session.submit_scroll` is not applied. TypeScript's prompt calls `toBottom` after a submit unless it is
   `keep` (`index.tsx:1650-1652`). The Rust prompt (E.2) has no submit hook for the route yet; a new message
   still scrolls into view while the reader is at the bottom, because the transcript is sticky.

Permission-blocked tools in exploration and activity groups (`partitionPending`) are not split out either: a
pending tool stays inside its collapsed group. The permission prompt (E.9a) shows the request below the
transcript, so nothing is hidden. Reason: E.9a and E.7a own the pending tool rows.
