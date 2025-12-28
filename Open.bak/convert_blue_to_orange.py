from PIL import Image
import os
import sys


def convert_blue_to_orange(image_path, output_path):
    """Convert blue colors to orange in an image"""
    try:
        img = Image.open(image_path)

        # Convert to RGBA if not already
        if img.mode != "RGBA":
            img = img.convert("RGBA")

        data = img.getdata()
        new_data = []

        for item in data:
            r, g, b, a = item

            # Detect blue colors (high blue, lower red and green)
            if b > r + 20 and b > g + 20:  # It's blue-ish
                # Convert to orange: #FF6B00 (255, 107, 0)
                # Keep alpha channel
                new_data.append((255, 107, 0, a))
            else:
                # Keep other colors as is
                new_data.append(item)

        img.putdata(new_data)
        img.save(output_path, "PNG")
        print(f"Converted: {image_path} -> {output_path}")
        return True

    except Exception as e:
        print(f"Error converting {image_path}: {e}")
        return False


def process_all_icons():
    """Process all icons from eski/icons folder"""
    source_dir = "eski/icons"
    target_dirs = [
        "packages/tauri/src-tauri/icons/dev",
        "packages/tauri/src-tauri/icons/prod",
    ]

    # Get all image files
    image_files = []
    for file in os.listdir(source_dir):
        if file.lower().endswith((".png", ".ico", ".icns")):
            image_files.append(file)

    print(f"Found {len(image_files)} icon files to process")

    # Process each file
    for image_file in image_files:
        source_path = os.path.join(source_dir, image_file)

        # Only process PNG files with Python
        if image_file.lower().endswith(".png"):
            for target_dir in target_dirs:
                if os.path.exists(target_dir):
                    output_path = os.path.join(target_dir, image_file)
                    convert_blue_to_orange(source_path, output_path)

        # For ICO and ICNS, just copy (they're complex formats)
        elif image_file.lower().endswith((".ico", ".icns")):
            for target_dir in target_dirs:
                if os.path.exists(target_dir):
                    output_path = os.path.join(target_dir, image_file)
                    # Just copy for now - these are complex binary formats
                    with open(source_path, "rb") as src:
                        with open(output_path, "wb") as dst:
                            dst.write(src.read())
                    print(f"Copied (not converted): {image_file} -> {output_path}")

    print("\nProcessing complete!")

    # Also process other PNG files in target directories
    print("\nProcessing other PNG files in target directories...")
    extra_sizes = {
        "32x32.png": ["64x64.png", "Square30x30Logo.png", "Square44x44Logo.png"],
        "128x128.png": [
            "Square107x107Logo.png",
            "Square142x142Logo.png",
            "Square150x150Logo.png",
            "Square71x71Logo.png",
            "Square89x89Logo.png",
            "StoreLogo.png",
        ],
        "256x256.png": [
            "128x128@2x.png",
            "Square284x284Logo.png",
            "Square310x310Logo.png",
        ],
    }

    for source_file, target_files in extra_sizes.items():
        source_path = os.path.join(source_dir, source_file)
        if os.path.exists(source_path):
            for target_dir in target_dirs:
                if os.path.exists(target_dir):
                    for target_file in target_files:
                        output_path = os.path.join(target_dir, target_file)
                        convert_blue_to_orange(source_path, output_path)


if __name__ == "__main__":
    # Check if PIL is installed
    try:
        from PIL import Image

        process_all_icons()
    except ImportError:
        print("PIL/Pillow not installed. Installing...")
        import subprocess

        subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow"])
        from PIL import Image

        process_all_icons()
