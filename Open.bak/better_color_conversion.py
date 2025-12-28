from PIL import Image
import os
import colorsys


def rgb_to_hsv(r, g, b):
    """Convert RGB to HSV"""
    r, g, b = r / 255.0, g / 255.0, b / 255.0
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    return h * 360, s * 100, v * 100


def hsv_to_rgb(h, s, v):
    """Convert HSV to RGB"""
    h, s, v = h / 360.0, s / 100.0, v / 100.0
    r, g, b = colorsys.hsv_to_rgb(h, s, v)
    return int(r * 255), int(g * 255), int(b * 255)


def convert_deepseek_blue_to_orange(image_path, output_path):
    """Convert DeepSeek blue logo to orange"""
    try:
        img = Image.open(image_path)

        # Convert to RGBA if not already
        if img.mode != "RGBA":
            img = img.convert("RGBA")

        data = img.getdata()
        new_data = []

        # DeepSeek blue is approximately #0066CC (0, 102, 204)
        # Target orange is #FF6B00 (255, 107, 0)

        for item in data:
            r, g, b, a = item

            # Convert to HSV to better detect blues
            h, s, v = rgb_to_hsv(r, g, b)

            # Detect blue colors (hue between 180 and 270 degrees)
            if 180 <= h <= 270 and s > 20 and v > 20:
                # Convert to orange (hue ~30 degrees)
                # Keep similar saturation and value
                new_h = 30  # Orange hue
                new_s = min(100, s * 1.2)  # Slightly more saturated
                new_v = v  # Keep same brightness

                new_r, new_g, new_b = hsv_to_rgb(new_h, new_s, new_v)
                new_data.append((new_r, new_g, new_b, a))
            elif s < 10:  # Very low saturation (grays/whites)
                # Keep as is
                new_data.append(item)
            else:
                # For other colors, shift hue toward orange
                # Calculate hue difference
                hue_diff = (30 - h) % 360
                if hue_diff > 180:
                    hue_diff -= 360

                # Shift hue partway toward orange
                new_h = h + hue_diff * 0.7
                new_h = new_h % 360
                new_data.append(hsv_to_rgb(new_h, s, v) + (a,))

        img.putdata(new_data)
        img.save(output_path, "PNG")
        print(f"Converted: {image_path} -> {output_path}")
        return True

    except Exception as e:
        print(f"Error converting {image_path}: {e}")
        return False


def process_directory(source_dir, target_dir):
    """Process all PNGs in directory"""
    if not os.path.exists(target_dir):
        print(f"Target directory does not exist: {target_dir}")
        return

    for file in os.listdir(source_dir):
        if file.lower().endswith(".png"):
            source_path = os.path.join(source_dir, file)
            target_path = os.path.join(target_dir, file)

            if os.path.exists(source_path):
                convert_deepseek_blue_to_orange(source_path, target_path)


if __name__ == "__main__":
    print("Converting DeepSeek blue logos to orange...")

    # Process main icons
    source_dir = "eski/icons"
    target_dirs = [
        "packages/tauri/src-tauri/icons/dev",
        "packages/tauri/src-tauri/icons/prod",
    ]

    for target_dir in target_dirs:
        process_directory(source_dir, target_dir)

    print("\nProcessing additional sizes...")

    # Map source files to target files
    size_mapping = {
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

    for source_file, target_files in size_mapping.items():
        source_path = os.path.join(source_dir, source_file)

        if os.path.exists(source_path):
            for target_dir in target_dirs:
                if os.path.exists(target_dir):
                    for target_file in target_files:
                        target_path = os.path.join(target_dir, target_file)
                        convert_deepseek_blue_to_orange(source_path, target_path)

    print("\nConversion complete!")
