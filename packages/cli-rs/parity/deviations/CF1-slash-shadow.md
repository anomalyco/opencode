# CF1: a plugin's slash name never takes another command's

**TypeScript.** A plugin's `slash.name` and `slash.aliases` are not checked. Slash completion lists every command
that claims a name, so a plugin's `/plugins` or `/cd` appears beside the host's. On submit, `argumentSlash` takes
the first match in keymap order, where the newest layer comes first, so a plugin's argument command with the
alias `cd` takes `/cd …` and its directory completion from the host. An empty alias completes as a bare `/`.

**Rust.** A plugin's name or alias that the prompt could not complete (empty, or with whitespace, `/` or a control
character) is left out when the command registers. A name another command holds is left out of the plugin's slash
entry: the host's own command keeps it, and between two plugins the one whose layer registered first keeps it. The
plugin's log names each name left out, once. A plugin whose every name is taken has no slash entry; its command
stays in the palette and keeps its key.

**Reason.** The host's slash commands, `/plugins` above all, are the user's way to reach and turn off a plugin;
a plugin must not be able to shadow them or break `/cd` completion. First-registered-wins between plugins keeps a
plugin that loads later from taking a name another plugin already shows.
