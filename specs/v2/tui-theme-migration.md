# TUI Theme V2 Migration Checklist

- [x] Add semantic accent foreground and border tokens so components stop
      reading `hue.accent[300]` directly.
- [ ] Add paired badge or label foreground/background tokens to replace V1
      `secondary` usages.
- [ ] Add strong warning and error background treatments with matching readable
      foregrounds.
- [x] Use `text.default` for active cursors, `background.surface.offset` for
      disabled cursors, and a lighter accent hue for focused form borders.
- [x] Add `background.surface.offset` and `background.surface.overlay`, map
      them from V1 panel/menu backgrounds, and use them as contextual surface
      defaults.
- [ ] Replace `selectedForeground` with complete V2 foreground/background pairs
      or a V2 contrast helper that supports transparent themes.
- [ ] Decide whether thinking opacity is fixed at `0.6` or belongs in a separate
      presentation-token system.
- [ ] Generate syntax styles from resolved V2 tokens, then migrate each UI
      surface and remove the V1 proxy once no flat V1 color reads remain.
