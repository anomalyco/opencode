from PIL import Image
import os


def create_orange_ico():
    """Create orange ICO file from converted PNGs"""
    ico_sizes = [16, 32, 48, 64, 128, 256]
    images = []

    # Use the converted 32x32.png as base and resize for other sizes
    base_path = "packages/tauri/src-tauri/icons/dev/32x32.png"

    if not os.path.exists(base_path):
        print(f"Base image not found: {base_path}")
        return

    base_img = Image.open(base_path)

    for size in ico_sizes:
        if size <= 64:
            # Resize from base image
            img = base_img.resize((size, size), Image.Resampling.LANCZOS)
        else:
            # For larger sizes, use 128x128 or 256x256
            if size == 128:
                larger_path = "packages/tauri/src-tauri/icons/dev/128x128.png"
            else:  # 256
                larger_path = "packages/tauri/src-tauri/icons/dev/256x256.png"

            if os.path.exists(larger_path):
                img = Image.open(larger_path).resize(
                    (size, size), Image.Resampling.LANCZOS
                )
            else:
                img = base_img.resize((size, size), Image.Resampling.LANCZOS)

        # Ensure RGBA mode
        if img.mode != "RGBA":
            img = img.convert("RGBA")

        images.append(img)

    # Save as ICO
    ico_path = "packages/tauri/src-tauri/icons/dev/icon.ico"
    images[0].save(
        ico_path,
        format="ICO",
        sizes=[(s, s) for s in ico_sizes],
        append_images=images[1:],
    )

    # Copy to prod
    prod_path = "packages/tauri/src-tauri/icons/prod/icon.ico"
    if os.path.exists("packages/tauri/src-tauri/icons/prod"):
        with open(ico_path, "rb") as src:
            with open(prod_path, "wb") as dst:
                dst.write(src.read())

    print(f"Created orange ICO file: {ico_path}")
    print(f"Copied to: {prod_path}")


def create_orange_icns():
    """Create orange ICNS file (simplified - just copy 256x256 as .icns)"""
    # For ICNS, we'll use the 256x256 PNG
    source_path = "packages/tauri/src-tauri/icons/dev/256x256.png"
    icns_path = "packages/tauri/src-tauri/icons/dev/icon.icns"

    if os.path.exists(source_path):
        with open(source_path, "rb") as src:
            with open(icns_path, "wb") as dst:
                dst.write(src.read())

        # Copy to prod
        prod_path = "packages/tauri/src-tauri/icons/prod/icon.icns"
        if os.path.exists("packages/tauri/src-tauri/icons/prod"):
            with open(icns_path, "rb") as src:
                with open(prod_path, "wb") as dst:
                    dst.write(src.read())

        print(f"Created orange ICNS file: {icns_path}")
        print(f"Copied to: {prod_path}")
    else:
        print(f"Source image not found for ICNS: {source_path}")


if __name__ == "__main__":
    print("Creating orange ICO and ICNS files...")
    create_orange_ico()
    create_orange_icns()
    print("\nDone! All icons should now be orange.")
