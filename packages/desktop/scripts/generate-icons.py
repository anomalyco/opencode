#!/usr/bin/env python3
"""Generate Jarvis desktop icons from packages/desktop/app-icon.png."""

from PIL import Image, ImageDraw
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "app-icon.png"


def load_source():
    if not SOURCE.exists():
        raise SystemExit(f"Missing source icon: {SOURCE}")
    return Image.open(SOURCE).convert("RGBA")


def make(src: Image.Image, size: int) -> Image.Image:
    return src.resize((size, size), Image.Resampling.LANCZOS)


def save_icon(img: Image.Image, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG")
    print(f"  Saved: {path}")


def convert_to_ico(png_paths: list[Path], ico_path: Path):
    # Pillow's ICO writer often collapses multi-size RGBA sources; embed PNGs manually.
    import io
    import struct

    entries: list[tuple[int, int, bytes]] = []
    for path in png_paths:
        image = Image.open(path).convert("RGBA")
        buf = io.BytesIO()
        image.save(buf, format="PNG")
        entries.append((image.width, image.height, buf.getvalue()))

    header = struct.pack("<HHH", 0, 1, len(entries))
    directory = bytearray()
    payload = bytearray()
    offset = 6 + 16 * len(entries)
    for width, height, png in entries:
        directory += struct.pack(
            "<BBBBHHII",
            0 if width >= 256 else width,
            0 if height >= 256 else height,
            0,
            0,
            1,
            32,
            len(png),
            offset + len(payload),
        )
        payload += png

    ico_path.parent.mkdir(parents=True, exist_ok=True)
    ico_path.write_bytes(header + bytes(directory) + bytes(payload))
    print(f"  Saved ICO: {ico_path}")


def generate_all(base_dir: Path):
    src = load_source()
    sizes = [16, 32, 64, 128, 256, 512, 1024]
    windows_square = [30, 44, 71, 89, 107, 142, 150, 284, 310]

    for channel in ["dev", "beta", "prod"]:
        print(f"\n=== Generating {channel} icons ===")
        channel_dir = base_dir / channel

        for size in sizes:
            save_icon(make(src, size), channel_dir / f"{size}x{size}.png")
            if size <= 512:
                save_icon(make(src, size * 2), channel_dir / f"{size}x{size}@2x.png")

        save_icon(make(src, 512), channel_dir / "icon.png")

        ico_pngs = []
        for s in [16, 32, 64, 128, 256, 512]:
            path = channel_dir / f"icon_{s}.png"
            save_icon(make(src, s), path)
            ico_pngs.append(path)
        convert_to_ico(ico_pngs, channel_dir / "icon.ico")

        dock_size = 1024
        dock = Image.new("RGBA", (dock_size, dock_size), (0, 0, 0, 0))
        dock_core_size = 820
        dock_core = make(src, dock_core_size)
        offset = (dock_size - dock_core_size) // 2
        dock.paste(dock_core, (offset, offset), dock_core)
        save_icon(dock, channel_dir / "dock.png")

        for sq in windows_square:
            margin = int(sq * 0.1)
            tile_size = max(1, sq - margin * 2)
            tile = Image.new("RGBA", (sq, sq), (0, 0, 0, 0))
            icon = make(src, tile_size)
            tile.paste(icon, (margin, margin), icon)
            save_icon(tile, channel_dir / f"Square{sq}x{sq}Logo.png")

        store = Image.new("RGBA", (50, 50), (0, 0, 0, 0))
        store_icon = make(src, 40)
        store.paste(store_icon, (5, 5), store_icon)
        save_icon(store, channel_dir / "StoreLogo.png")

        android_dir = channel_dir / "android"
        for density, size in [
            ("mdpi", 36),
            ("hdpi", 48),
            ("xhdpi", 72),
            ("xxhdpi", 96),
            ("xxxhdpi", 144),
        ]:
            mipmap_dir = android_dir / f"mipmap-{density}"
            img = make(src, size)
            save_icon(img, mipmap_dir / "ic_launcher_background.png")
            save_icon(img, mipmap_dir / "ic_launcher_foreground.png")

            circ = Image.new("RGBA", (size, size), (0, 0, 0, 0))
            mask = Image.new("L", (size, size), 0)
            ImageDraw.Draw(mask).ellipse([0, 0, size, size], fill=255)
            circ.paste(img, (0, 0), mask)
            save_icon(circ, mipmap_dir / "ic_launcher.png")

        anydpi_dir = android_dir / "mipmap-anydpi-v26"
        anydpi_dir.mkdir(parents=True, exist_ok=True)
        (anydpi_dir / "ic_launcher.xml").write_text(
            """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
""",
            encoding="utf-8",
        )

        ios_dir = channel_dir / "ios"
        for size in [20, 29, 40, 60, 76, 83]:
            for mult in [1, 2, 3]:
                actual_size = int(size * mult)
                if actual_size > 1024:
                    continue
                suffix = f"@{mult}x" if mult > 1 else "@1x"
                save_icon(make(src, actual_size), ios_dir / f"AppIcon-{int(size)}x{int(size)}{suffix}.png")

        save_icon(make(src, 1024), ios_dir / "AppIcon-512@2x.png")
        print(f"  Done with {channel}!")


if __name__ == "__main__":
    base = ROOT / "icons"
    generate_all(base)
    print("\n=== ALL ICONS GENERATED FROM app-icon.png ===")
    print("Run: bun run scripts/copy-icons.ts prod")
