# Desktop Icons

Each channel (`dev`, `beta`, `prod`) has its own icon set. `scripts/copy-icons.ts` copies the active channel's folder to `resources/icons`, where electron-builder reads `icon.icns` (macOS), `icon.ico` (Windows), and the PNG sizes (Linux).

To regenerate a channel's set:

- Generate the PNG and ICO sizes from a square source image, for example with `bunx @tauri-apps/cli icon app-icon.png -o icons/<channel>`.
- Use [Image2Icon](https://img2icnsapp.com/)'s 'Big Sur Icon' preset to generate `icon.icns`. An `icon.icns` generated straight from the source image lacks the shadow and padding macOS expects, so the app icon looks larger than other apps.
- For unpackaged Electron on macOS, `app.dock.setIcon()` should use a PNG. Keep `dock.png` in each channel folder synced with the `icon_128x128@2x.png` extracted from that channel's `icon.icns`, so the dev Dock icon matches the packaged app's inset.
