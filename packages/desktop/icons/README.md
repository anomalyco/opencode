# Icons

The VeniceCode mark is a Venetian Gothic ogee window drawn as ASCII art — phosphor
green (`#48FF6E`) on near-black (`#040805`), in the spirit of old-school terminal-art
crews. `generate.py` rasterises the arch geometry to a character grid, stamps it in
Menlo Bold, then adds the bloom and scanlines.

To change it, edit the geometry or the character ramp in `generate.py` and run:

```bash
python3 icons/generate.py
```

That renders a 1024×1024 master on the macOS Big Sur icon grid (824pt body, continuous
corners, baked drop shadow) and writes `icon.icns`, `icon.png`, `dock.png` and the raster
sizes into `prod/`, `dev/` and `beta/`. Requires Pillow (`pip install pillow`) and macOS
`iconutil`.

Because the master already carries the Big Sur inset and shadow, no separate Image2Icon
pass is needed — `iconutil` just downsamples it.

`cols`/`rows` control the character grid. Coarser grids (fewer, bigger glyphs) survive
better at 32px; finer grids look richer in the Finder but turn to mush in the Dock.

For unpackaged Electron on macOS, `app.dock.setIcon()` uses a PNG, so `dock.png` is kept in
each channel folder as the 256px render of the same master.

The `32x32`/`64x64`/`128x128` rasters are consumed only by the Nix desktop derivation; the
macOS build itself uses `icon.icns` alone.
