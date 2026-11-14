# F16: a plugin's tree is held to limits on host work

## TypeScript

A plugin renders whatever tree it builds. A tree of a hundred thousand nodes, a patch of a hundred thousand lines or
a large image is built and laid out on the UI thread in full, and the TUI waits for it. A plugin's updates run as its
messages arrive, however many there are.

## Rust

The host admits a plugin's tree by what it would cost before it builds any of it (synthesis 4.2, phase Pl), on every
carrier and for built-ins too:

- The nodes of a tree, its rows built at once (a node is a row, a patch, code or Markdown also its lines), a node's
  text and a patch's hunks have limits. The node that would cross one shows one muted row in its place, `⋯ too many
  nodes`, `⋯ too large to build at once`, `⋯ too large: <n> bytes` or `⋯ too large: <n> hunks`, standing for the
  siblings after it, and the rest of the tree draws. A tree that breaks the contract is refused whole, as before.
- What the host holds for a plugin (its trees' nodes, its content, its decoded images) has a limit per plugin and one
  for all plugins. Content past it is not kept, and a node that shows it reads `⋯ its content is past what the plugin
  may hold`.
- An image is admitted by its bytes and header and decodes on one of two workers; it shows once decoded. One past the
  bytes of an image, 2,048 pixels on a side, or the decoded bytes its plugin may hold, reads `⋯ image too large`.
- The rows all trees build in one frame are shared by every plugin: a revision the frame has no rows left for shows a
  frame later, and a list's items mount over the frames after (a first view shows in its frame).
- A plugin's updates run in turn with other plugins' under the frame budget, after the input that came before them;
  the rest run in the next frames. A mailbox full at the end of more than 12 of the last 120 frames makes its plugin
  slow, with one notice: "Its mailbox is full".

`OPENCODE_PLUGIN_LIMITS` sets the budget as before; the limits of host work are the client's.

## Reason

O-123 runs plugin code in the client's process and on its UI thread, so what a plugin's tree makes the host build is
UI-thread time the user waits for (synthesis 4.2, "Limits on host work"). TS has the same exposure and no limit; a
limit there would be a change of its own.
