from PIL import Image
import os


def create_orange_ico_from_converted():
    """Create ICO file from the converted orange PNGs"""
    dev_dir = "packages/tauri/src-tauri/icons/dev"

    if not os.path.exists(dev_dir):
        print(f"Dev directory not found: {dev_dir}")
        return

    # ICO sizes
    ico_sizes = [16, 32, 48, 64, 128, 256]
    images = []

    # Try to get images for each size
    for size in ico_sizes:
        # Find appropriate source file
        if size <= 32:
            source_file = "32x32.png"
        elif size <= 64:
            source_file = "64x64.png"
        elif size <= 128:
            source_file = "128x128.png"
        else:  # 256
            source_file = "256x256.png"

        source_path = os.path.join(dev_dir, source_file)

        if os.path.exists(source_path):
            img = Image.open(source_path)
            # Resize to target size
            img = img.resize((size, size), Image.Resampling.LANCZOS)

            # Ensure RGBA
            if img.mode != "RGBA":
                img = img.convert("RGBA")

            images.append(img)
        else:
            print(f"Warning: Source file not found for size {size}: {source_file}")

    if images:
        # Save ICO
        ico_path = os.path.join(dev_dir, "icon.ico")
        images[0].save(
            ico_path,
            format="ICO",
            sizes=[(s, s) for s in ico_sizes[: len(images)]],
            append_images=images[1:],
        )
        print(f"Created orange ICO: {ico_path}")

        # Copy to prod
        prod_dir = "packages/tauri/src-tauri/icons/prod"
        if os.path.exists(prod_dir):
            prod_ico_path = os.path.join(prod_dir, "icon.ico")
            with open(ico_path, "rb") as src:
                with open(prod_ico_path, "wb") as dst:
                    dst.write(src.read())
            print(f"Copied to prod: {prod_ico_path}")
    else:
        print("Error: No images found to create ICO")


def create_orange_icns_from_converted():
    """Create ICNS file from converted orange PNG"""
    dev_dir = "packages/tauri/src-tauri/icons/dev"

    # For ICNS, we'll use the 256x256 PNG
    source_path = os.path.join(dev_dir, "256x256.png")

    if os.path.exists(source_path):
        icns_path = os.path.join(dev_dir, "icon.icns")

        # Copy PNG as ICNS (simplified - real ICNS is more complex)
        with open(source_path, "rb") as src:
            with open(icns_path, "wb") as dst:
                dst.write(src.read())

        print(f"Created orange ICNS: {icns_path}")

        # Copy to prod
        prod_dir = "packages/tauri/src-tauri/icons/prod"
        if os.path.exists(prod_dir):
            prod_icns_path = os.path.join(prod_dir, "icon.icns")
            with open(icns_path, "rb") as src:
                with open(prod_icns_path, "wb") as dst:
                    dst.write(src.read())
            print(f"Copied to prod: {prod_icns_path}")
    else:
        print(f"Source file not found for ICNS: {source_path}")


def verify_conversion():
    """Verify the conversion was successful"""
    print("\n=== Verifying Conversion ===")

    test_files = [
        ("packages/tauri/src-tauri/icons/dev/128x128.png", "128x128"),
        ("packages/tauri/src-tauri/icons/dev/32x32.png", "32x32"),
        ("packages/tauri/src-tauri/icons/dev/256x256.png", "256x256"),
    ]

    for file_path, name in test_files:
        if os.path.exists(file_path):
            try:
                img = Image.open(file_path)
                img_rgb = img.convert("RGB")

                # Get average color
                img_small = img_rgb.resize((1, 1), Image.Resampling.LANCZOS)
                r, g, b = img_small.getpixel((0, 0))

                print(f"{name}: RGB({r}, {g}, {b})", end=" ")

                # Check if it's orange
                if r > 200 and 80 < g < 180 and b < 100:
                    print("✓ ORANGE")
                else:
                    print("✗ NOT ORANGE ENOUGH")
            except Exception as e:
                print(f"{name}: Error - {e}")
        else:
            print(f"{name}: File not found")


if __name__ == "__main__":
    print("Creating orange ICO and ICNS files from converted PNGs...")
    create_orange_ico_from_converted()
    create_orange_icns_from_converted()
    verify_conversion()
    print("\n=== Process Complete ===")
