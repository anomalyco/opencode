# Keybindings vs. Keymappings

Make it `keymappings`, closer to neovim. Can be layered like `<leader>abc`. Commands don't define their binding, but have an id that a key can be mapped to like

```ts
{ key: "ctrl+w", cmd: string | function, description }
```

_Why_
Currently its keybindings that have an `id` like `message_redo` and then a command can use that or define it's own binding. While some keybindings are just used with `.match` in arbitrary key handlers and there is no info what the key is used for, except the binding id maybe. It also is unknown in which context/scope what binding is active, so a plugin like `which-key` is nearly impossible to get right.
