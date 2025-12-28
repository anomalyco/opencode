from PIL import Image
import os


def simple_blue_to_orange(image_path, output_path):
    """Simple but effective blue to orange conversion"""
    try:
        img = Image.open(image_path)

        # Convert to RGB first
        if img.mode != "RGB":
            img = img.convert("RGB")

        # Get pixel data
        pixels = img.load()
        width, height = img.size

        # Process each pixel
        for x in range(width):
            for y in range(height):
                r, g, b = pixels[x, y]

                # Check if pixel is blue-ish (DeepSeek logo blue)
                # DeepSeek blue is typically high blue, lower red and green
                if b > r + 30 and b > g + 30:
                    # This is a blue pixel from the logo
                    # Calculate brightness
                    brightness = (r + g + b) / 3

                    # Convert to orange based on brightness
                    if brightness < 100:
                        # Dark blue -> dark orange
                        pixels[x, y] = (180, 70, 0)
                    elif brightness < 180:
                        # Medium blue -> orange #FF6B00
                        pixels[x, y] = (255, 107, 0)
                    else:
                        # Light blue -> light orange
                        pixels[x, y] = (255, 150, 50)
                elif r > 240 and g > 240 and b > 240:
                    # White background, keep as is
                    pass
                elif abs(r - g) < 20 and abs(g - b) < 20 and abs(r - b) < 20:
                    # Gray pixel, make it orange-tinted
                    if r > 200:
                        # Light gray, keep as is
                        pass
                    else:
                        # Darker gray, make orange-tinted
                        pixels[x, y] = (min(255, r + 50), g, max(0, b - 30))

        # Save
        img.save(output_path, "PNG")
        print(f"Converted: {os.path.basename(image_path)}")
        return True

    except Exception as e:
        print(f"Error converting {image_path}: {e}")
        return False


def check_result(image_path):
    """Check if image is now orange"""
    try:
        img = Image.open(image_path)
        img = img.convert("RGB")

        # Get average color
        img_small = img.resize((1, 1), Image.Resampling.LANCZOS)
        r, g, b = img_small.getpixel((0, 0))

        return r, g, b
    except:
        return 0, 0, 0


def main():
    print("=== SIMPLE Blue to Orange Conversion ===")

    source_dir = "eski/icons"
    dev_dir = "packages/tauri/src-tauri/icons/dev"
    prod_dir = "packages/tauri/src-tauri/icons/prod"

    # Process key files
    key_files = ["128x128.png", "32x32.png", "256x256.png"]

    for file in key_files:
        source_path = os.path.join(source_dir, file)

        if os.path.exists(source_path):
            print(f"\nProcessing {file}...")

            # Check original color
            orig_r, orig_g, orig_b = check_result(source_path)
            print(f"  Original: RGB({orig_r}, {orig_g}, {orig_b})")

            # Convert for dev
            if os.path.exists(dev_dir):
                output_path = os.path.join(dev_dir, file)
                if simple_blue_to_orange(source_path, output_path):
                    new_r, new_g, new_b = check_result(output_path)
                    print(f"  Dev result: RGB({new_r}, {new_g}, {new_b})")

                    # Check if orange
                    if new_r > 200 and 80 < new_g < 180 and new_b < 100:
                        print("  ✓ SUCCESS: Now orange!")
                    else:
                        print("  ✗ Still not orange enough")

            # Convert for prod
            if os.path.exists(prod_dir):
                output_path = os.path.join(prod_dir, file)
                simple_blue_to_orange(source_path, output_path)

    print("\n=== Creating ICO and ICNS ===")
    # Recreate ICO and ICNS
    dev_dir = "packages/tauri/src-tauri/icons/dev"

    # Create ICO from 32x32.png
    ico_source = os.path.join(dev_dir, "32x32.png")
    if os.path.exists(ico_source):
        img = Image.open(ico_source)

        # Create ICO with multiple sizes
        sizes = [16, 32, 48, 64, 128, 256]
        images = []

        for size in sizes:
            resized = img.resize((size, size), Image.Resampling.LANCZOS)
            if resized.mode != "RGBA":
                resized = resized.convert("RGBA")
            images.append(resized)

        # Save ICO
        ico_path = os.path.join(dev_dir, "icon.ico")
        images[0].save(ico_path, format="ICO", sizes=[(s, s) for s in sizes])
        print(f"Created ICO: {ico_path}")

        # Copy to prod
        prod_ico = os.path.join(prod_dir, "icon.ico")
        with open(ico_path, "rb") as src:
            with open(prod_ico, "wb") as dst:
                dst.write(src.read())
        print(f"Copied ICO to prod")

    # Create ICNS from 256x256.png
    icns_source = os.path.join(dev_dir, "256x256.png")
    if os.path.exists(icns_source):
        icns_path = os.path.join(dev_dir, "icon.icns")
        with open(icns_source, "rb") as src:
            with open(icns_path, "wb") as dst:
                dst.write(src.read())
        print(f"Created ICNS: {icns_path}")

        # Copy to prod
        prod_icns = os.path.join(prod_dir, "icon.icns")
        with open(icns_path, "rb") as src:
            with open(prod_icns, "wb") as dst:
                dst.write(src.read())
        print(f"Copied ICNS to prod")

    print("\n=== FINAL CHECK ===")
    print("Check these files manually:")
    print("1. packages/tauri/src-tauri/icons/dev/128x128.png")
    print("2. packages/tauri/src-tauri/icons/dev/32x32.png")
    print("3. packages/tauri/src-tauri/icons/dev/icon.ico")
    print("\nThe DeepSeek fish logo should now be ORANGE instead of blue.")


if __name__ == "__main__":
    main()
