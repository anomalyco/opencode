from PIL import Image
import os
import numpy as np


def force_blue_to_orange(image_path, output_path):
    """Force all blue pixels to orange in DeepSeek logo"""
    try:
        # Open image
        img = Image.open(image_path)

        # Convert to RGBA
        if img.mode != "RGBA":
            img = img.convert("RGBA")

        # Convert to numpy array
        data = np.array(img)

        # Extract channels
        r, g, b, a = data[:, :, 0], data[:, :, 1], data[:, :, 2], data[:, :, 3]

        # Find all non-background pixels (not white/transparent)
        # White background is typically RGB(255, 255, 255) or close
        background_mask = (r > 250) & (g > 250) & (b > 250)

        # For all non-background pixels, convert blues to orange
        for i in range(data.shape[0]):
            for j in range(data.shape[1]):
                if (
                    not background_mask[i, j] and a[i, j] > 10
                ):  # Not background and not transparent
                    pixel_r, pixel_g, pixel_b = r[i, j], g[i, j], b[i, j]

                    # Check if pixel has any significant color (not gray)
                    max_val = max(pixel_r, pixel_g, pixel_b)
                    min_val = min(pixel_r, pixel_g, pixel_b)

                    if max_val - min_val > 20:  # Has significant color
                        # Convert to orange based on original brightness
                        brightness = (pixel_r + pixel_g + pixel_b) / 3

                        # Map to orange gradient
                        if brightness < 80:
                            # Dark -> dark orange
                            r[i, j] = 180
                            g[i, j] = 70
                            b[i, j] = 0
                        elif brightness < 160:
                            # Medium -> orange #FF6B00
                            r[i, j] = 255
                            g[i, j] = 107
                            b[i, j] = 0
                        else:
                            # Light -> light orange
                            r[i, j] = 255
                            g[i, j] = 150
                            b[i, j] = 50
                    else:
                        # Grayish pixel, make it orange-ish gray
                        if brightness > 200:
                            # Very light, keep as is
                            pass
                        else:
                            # Make it orange-tinted
                            r[i, j] = min(255, int(pixel_r * 1.2))
                            g[i, j] = pixel_g
                            b[i, j] = max(0, int(pixel_b * 0.5))

        # Recombine
        result = np.stack([r, g, b, a], axis=2)
        result_img = Image.fromarray(result, "RGBA")
        result_img.save(output_path, "PNG")

        print(f"Force converted: {os.path.basename(image_path)}")
        return True

    except Exception as e:
        print(f"Error: {e}")
        return False


def process_critical_files():
    """Process the most important icon files"""
    source_dir = "eski/icons"
    dev_dir = "packages/tauri/src-tauri/icons/dev"
    prod_dir = "packages/tauri/src-tauri/icons/prod"

    # Process main files
    main_files = [
        "128x128.png",
        "256x256.png",
        "32x32.png",
        "512x512.png",
        "app-icon.png",
        "icon.png",
    ]

    print("Force converting main icon files...")
    for file in main_files:
        source_path = os.path.join(source_dir, file)

        if os.path.exists(source_path):
            # Dev
            if os.path.exists(dev_dir):
                output_path = os.path.join(dev_dir, file)
                force_blue_to_orange(source_path, output_path)

            # Prod
            if os.path.exists(prod_dir):
                output_path = os.path.join(prod_dir, file)
                force_blue_to_orange(source_path, output_path)

    # Process other sizes from the main files
    print("\nProcessing other sizes...")
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
            for target_dir in [dev_dir, prod_dir]:
                if os.path.exists(target_dir):
                    for target_file in target_files:
                        target_path = os.path.join(target_dir, target_file)
                        force_blue_to_orange(source_path, target_path)


if __name__ == "__main__":
    print("=== FORCE Converting DeepSeek Blue to Orange ===")
    process_critical_files()
    print("\n=== Force Conversion Complete ===")
