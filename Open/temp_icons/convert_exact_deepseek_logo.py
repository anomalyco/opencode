from PIL import Image
import os
import numpy as np


def convert_deepseek_blue_to_orange_exact(image_path, output_path):
    """Convert DeepSeek blue fish logo to orange exactly"""
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

        # DeepSeek blue is approximately #0066CC (0, 102, 204)
        # We want to convert it to orange #FF6B00 (255, 107, 0)

        # Method 1: Direct color mapping for exact blue pixels
        # Create mask for blue fish logo pixels
        # Fish logo has specific blue colors

        # Find all non-transparent pixels
        non_transparent = a > 10

        # For each non-transparent pixel, convert blue to orange
        for i in range(data.shape[0]):
            for j in range(data.shape[1]):
                if a[i, j] > 10:  # Not transparent
                    pixel_r, pixel_g, pixel_b = r[i, j], g[i, j], b[i, j]

                    # Check if it's part of the blue fish logo
                    # Fish logo has blues in this range
                    if pixel_b > max(pixel_r, pixel_g) + 20:
                        # This is a blue pixel from the fish logo
                        # Convert to orange based on brightness
                        brightness = (pixel_r + pixel_g + pixel_b) / 3

                        if brightness < 100:
                            # Dark blue -> dark orange
                            r[i, j] = 200
                            g[i, j] = 80
                            b[i, j] = 0
                        elif brightness < 180:
                            # Medium blue -> medium orange
                            r[i, j] = 255
                            g[i, j] = 107
                            b[i, j] = 0
                        else:
                            # Light blue -> light orange
                            r[i, j] = 255
                            g[i, j] = 150
                            b[i, j] = 50
                    elif pixel_r > 200 and pixel_g > 200 and pixel_b > 200:
                        # White/light background, keep as is
                        pass
                    else:
                        # Other colors (text, etc.), keep as is
                        pass

        # Recombine
        result = np.stack([r, g, b, a], axis=2)
        result_img = Image.fromarray(result, "RGBA")
        result_img.save(output_path, "PNG")

        print(f"Converted: {os.path.basename(image_path)}")
        return True

    except Exception as e:
        print(f"Error converting {image_path}: {e}")
        return False


def process_all_icons():
    """Process all icons from eski/icons to tauri/icons"""
    source_dir = "eski/icons"
    dev_dir = "packages/tauri/src-tauri/icons/dev"
    prod_dir = "packages/tauri/src-tauri/icons/prod"

    # First, let's see what the original logo looks like
    print("Analyzing original DeepSeek logo...")
    sample_path = os.path.join(source_dir, "128x128.png")
    if os.path.exists(sample_path):
        img = Image.open(sample_path)
        print(f"Sample logo size: {img.size}, mode: {img.mode}")

        # Get some pixel samples
        img_rgba = img.convert("RGBA")
        pixels = list(img_rgba.getdata())

        # Find blue pixels
        blue_pixels = []
        for i, pixel in enumerate(pixels[:100]):  # Check first 100 pixels
            r, g, b, a = pixel
            if a > 10 and b > r + 20 and b > g + 20:
                blue_pixels.append((r, g, b))

        if blue_pixels:
            avg_r = sum(p[0] for p in blue_pixels) // len(blue_pixels)
            avg_g = sum(p[1] for p in blue_pixels) // len(blue_pixels)
            avg_b = sum(p[2] for p in blue_pixels) // len(blue_pixels)
            print(f"Average blue color in logo: RGB({avg_r}, {avg_g}, {avg_b})")

    # Process all PNG files
    print("\nConverting PNG files...")
    for file in os.listdir(source_dir):
        if file.lower().endswith(".png"):
            source_path = os.path.join(source_dir, file)

            # Convert for dev
            if os.path.exists(dev_dir):
                output_path = os.path.join(dev_dir, file)
                convert_deepseek_blue_to_orange_exact(source_path, output_path)

            # Convert for prod
            if os.path.exists(prod_dir):
                output_path = os.path.join(prod_dir, file)
                convert_deepseek_blue_to_orange_exact(source_path, output_path)

    # Process other sizes
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
                        convert_deepseek_blue_to_orange_exact(source_path, target_path)

    print("\nCopying ICO and ICNS files (will convert later)...")
    # For ICO and ICNS, we'll create new ones from converted PNGs
    for file in os.listdir(source_dir):
        if file.lower().endswith((".ico", ".icns")):
            source_path = os.path.join(source_dir, file)

            for target_dir in [dev_dir, prod_dir]:
                if os.path.exists(target_dir):
                    target_path = os.path.join(target_dir, file)
                    # Just copy for now
                    with open(source_path, "rb") as src:
                        with open(target_path, "wb") as dst:
                            dst.write(src.read())
                    print(f"Copied: {file}")


if __name__ == "__main__":
    print("=== Converting DeepSeek Blue Fish Logo to Orange ===")
    process_all_icons()
    print("\n=== Conversion Complete ===")
