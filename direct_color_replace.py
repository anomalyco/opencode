from PIL import Image
import os
import numpy as np


def direct_blue_to_orange(image_path, output_path):
    """Directly replace blue with orange"""
    try:
        img = Image.open(image_path)

        # Convert to RGBA
        img = img.convert("RGBA")

        # Convert to numpy array for faster processing
        data = np.array(img)

        # Define blue color range (DeepSeek blue is ~#0066CC)
        # Target orange: #FF6B00 (255, 107, 0)

        # Extract channels
        r, g, b, a = data[:, :, 0], data[:, :, 1], data[:, :, 2], data[:, :, 3]

        # Create mask for blue pixels (high blue, lower red and green)
        blue_mask = (b > r + 40) & (b > g + 40) & (b > 100)

        # For blue pixels, replace with orange
        r[blue_mask] = 255  # Red channel
        g[blue_mask] = 107  # Green channel
        b[blue_mask] = 0  # Blue channel
        # Alpha channel stays the same

        # Also handle lighter blues and blue tints
        light_blue_mask = (b > r + 20) & (b > g + 20) & (b > 50)
        r[light_blue_mask] = np.minimum(255, r[light_blue_mask] + 150)
        g[light_blue_mask] = np.minimum(255, g[light_blue_mask] + 50)
        b[light_blue_mask] = np.maximum(0, b[light_blue_mask] - 100)

        # Recombine channels
        result = np.stack([r, g, b, a], axis=2)

        # Convert back to Image
        result_img = Image.fromarray(result, "RGBA")
        result_img.save(output_path, "PNG")

        print(f"Converted: {image_path} -> {output_path}")
        return True

    except Exception as e:
        print(f"Error: {e}")
        return False


def process_all():
    """Process all icon files"""
    source_dir = "eski/icons"
    target_dirs = [
        "packages/tauri/src-tauri/icons/dev",
        "packages/tauri/src-tauri/icons/prod",
    ]

    # Process main PNG files
    for file in os.listdir(source_dir):
        if file.lower().endswith(".png"):
            source_path = os.path.join(source_dir, file)

            for target_dir in target_dirs:
                if os.path.exists(target_dir):
                    target_path = os.path.join(target_dir, file)
                    direct_blue_to_orange(source_path, target_path)

    # Process additional sizes
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
                        direct_blue_to_orange(source_path, target_path)


if __name__ == "__main__":
    print("Direct blue to orange conversion...")
    process_all()
    print("\nDone!")
