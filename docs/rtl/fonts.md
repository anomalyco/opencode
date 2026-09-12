# Arabic fonts & terminal setup

The TUI cannot bundle or select fonts. It emits Unicode cells; the terminal
emulator renders them with a font **you** choose. The bidi work in this
repository fixes **ordering, direction, alignment and wrapping**; the terminal
font is what makes Arabic letters join and look right.

> العربية: [fonts.ar.md](./fonts.ar.md)

## Why not set the font from OpenCode

A terminal cell is one Unicode code point drawn by the terminal's font engine
(DirectWrite on Windows Terminal). Applications cannot ship fonts into that
pipeline. What an application *can* do — and what this repository does — is put
the right code points in the right cells in the right order.

## Recommended Arabic-capable fonts

| Font | Style | Notes |
| --- | --- | --- |
| [Cairo](https://fonts.google.com/specimen/Cairo) | modern sans | proportional; best used as a fallback |
| [Noto Naskh Arabic](https://fonts.google.com/noto/specimen/Noto+Naskh+Arabic) | traditional naskh | proportional |
| [IBM Plex Sans Arabic](https://fonts.google.com/specimen/IBM+Plex+Sans+Arabic) | professional sans | proportional |
| [Amiri](https://fonts.google.com/specimen/Amiri) | classical naskh | proportional |
| [Tajawal](https://fonts.google.com/specimen/Tajawal) / [Almarai](https://fonts.google.com/specimen/Almarai) | modern sans | proportional |

Windows already ships **Segoe UI**, **Tahoma** and **Arial**, which cover Arabic
glyphs, so Arabic renders out of the box — just not always with consistent
joining. Installing one of the fonts above improves shaping.

> Note: these Arabic fonts are **proportional**, not monospaced. Setting one as
> the terminal's main `face` makes Latin text non-monospaced and can misalign
> columns. The recommended setup keeps your monospaced face and adds the Arabic
> font as a **fallback**, so only Arabic glyphs use it.

## Windows Terminal

`settings.json` (Store build):

```
%LOCALAPPDATA%\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json
```

### Pick it from inside OpenCode

Type `/fonts` in the prompt to open the font picker. It lists the fonts installed
on your machine (recommended Arabic fonts first), and writes your choice into
the terminal's settings for you — keeping a timestamped backup. Then restart the
terminal. It never installs fonts.

Under the hood it sets `profiles.defaults.font.face` to a comma-separated
fallback chain (the only fallback mechanism Windows Terminal honors), so
Arabic uses the chosen font while Latin and code stay monospaced.

### Manually

Add the Arabic fonts to the `face` chain in `profiles.defaults.font`:

```json
{
  "profiles": {
    "defaults": {
      "font": {
        "face": "Cascadia Mono, Cairo, Noto Naskh Arabic, Segoe UI, Tahoma"
      }
    }
  }
}
```

Or run the helper script in this folder, which backs up `settings.json` first:

```powershell
powershell -ExecutionPolicy Bypass -File docs/rtl/configure-windows-terminal-font.ps1
# or also set the main face:
powershell -ExecutionPolicy Bypass -File docs/rtl/configure-windows-terminal-font.ps1 -Face "Cascadia Mono"
```

Restart Windows Terminal after changing the setting.

## VS Code integrated terminal

`settings.json`:

```json
{
  "terminal.integrated.fontFamily": "'Cascadia Mono', 'Cairo', 'Noto Naskh Arabic', monospace"
}
```

## Legacy Windows Console (conhost)

Right-click the title bar → Properties → Font. Coverage is limited; Windows
Terminal is recommended for Arabic.

## Verify

Type this in the OpenCode prompt and confirm the words read right-to-left and
are right-aligned:

```
أهلاً بك في OpenCode
```
