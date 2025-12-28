from PIL import Image
import os
import shutil

# Target darker orange color: RGB(255, 140, 70) - #FF8C46
DARKER_ORANGE = (255, 140, 70)


def convert_to_darker_orange(source_image_path, target_image_path):
    """Convert an image to darker orange"""
    try:
        img = Image.open(source_image_path)

        if img.mode != "RGBA":
            img = img.convert("RGBA")

        data = img.getdata()
        new_data = []

        for pixel in data:
            r, g, b, a = pixel

            if a < 10:  # Fully transparent
                new_data.append(pixel)
            elif r > 250 and g > 250 and b > 250:  # White background
                new_data.append(pixel)
            elif a < 200:  # Semi-transparent (edges)
                # Blend with darker orange
                blend_factor = a / 255.0
                new_r = int(255 * blend_factor + r * (1 - blend_factor))
                new_g = int(140 * blend_factor + g * (1 - blend_factor))
                new_b = int(70 * blend_factor + b * (1 - blend_factor))
                new_data.append((new_r, new_g, new_b, a))
            else:
                # Solid non-white pixel - make it darker orange
                new_data.append((255, 140, 70, a))

        img.putdata(new_data)
        img.save(target_image_path, "PNG")
        return True

    except Exception as e:
        print(f"Error converting {source_image_path}: {e}")
        return False


def update_android_icons():
    """Update Android icons in both dev and prod"""
    print("Updating Android icons...")

    # Source icon to use as template (128x128.png from dev)
    source_icon = "packages/tauri/src-tauri/icons/dev/128x128.png"

    if not os.path.exists(source_icon):
        print(f"Source icon not found: {source_icon}")
        return

    # Android directories to update
    android_dirs = [
        "packages/tauri/src-tauri/icons/dev/android",
        "packages/tauri/src-tauri/icons/prod/android",
    ]

    for android_dir in android_dirs:
        if os.path.exists(android_dir):
            print(f"\nProcessing {android_dir}:")

            # Find all PNG files in android directory
            png_files = []
            for root, dirs, files in os.walk(android_dir):
                for file in files:
                    if file.lower().endswith(".png"):
                        png_files.append(os.path.join(root, file))

            print(f"Found {len(png_files)} PNG files")

            # Update each file
            updated_count = 0
            for png_file in png_files:
                try:
                    # Get the size of target image
                    target_img = Image.open(png_file)
                    target_size = target_img.size
                    target_img.close()

                    # Open source icon and resize to target size
                    source_img = Image.open(source_icon)
                    resized_source = source_img.resize(
                        target_size, Image.Resampling.LANCZOS
                    )

                    # Save resized source to target
                    resized_source.save(png_file, "PNG")

                    # Now convert to darker orange
                    if convert_to_darker_orange(png_file, png_file):
                        updated_count += 1

                    source_img.close()

                except Exception as e:
                    print(f"  Error updating {os.path.basename(png_file)}: {e}")

            print(f"  Updated {updated_count} files")
        else:
            print(f"Directory not found: {android_dir}")


def update_ios_icons():
    """Update iOS icons in both dev and prod"""
    print("\nUpdating iOS icons...")

    # Source icon to use as template (128x128.png from dev)
    source_icon = "packages/tauri/src-tauri/icons/dev/128x128.png"

    if not os.path.exists(source_icon):
        print(f"Source icon not found: {source_icon}")
        return

    # iOS directories to update
    ios_dirs = [
        "packages/tauri/src-tauri/icons/dev/ios",
        "packages/tauri/src-tauri/icons/prod/ios",
    ]

    for ios_dir in ios_dirs:
        if os.path.exists(ios_dir):
            print(f"\nProcessing {ios_dir}:")

            # Find all PNG files in ios directory
            png_files = []
            for root, dirs, files in os.walk(ios_dir):
                for file in files:
                    if file.lower().endswith(".png"):
                        png_files.append(os.path.join(root, file))

            print(f"Found {len(png_files)} PNG files")

            # Update each file
            updated_count = 0
            for png_file in png_files:
                try:
                    # Get the size of target image
                    target_img = Image.open(png_file)
                    target_size = target_img.size
                    target_img.close()

                    # Open source icon and resize to target size
                    source_img = Image.open(source_icon)
                    resized_source = source_img.resize(
                        target_size, Image.Resampling.LANCZOS
                    )

                    # Save resized source to target
                    resized_source.save(png_file, "PNG")

                    # Now convert to darker orange
                    if convert_to_darker_orange(png_file, png_file):
                        updated_count += 1

                    source_img.close()

                except Exception as e:
                    print(f"  Error updating {os.path.basename(png_file)}: {e}")

            print(f"  Updated {updated_count} files")
        else:
            print(f"Directory not found: {ios_dir}")


def check_results():
    """Check a few files to verify update"""
    print("\n=== Checking Results ===")

    test_files = [
        "packages/tauri/src-tauri/icons/dev/android/mipmap-hdpi/ic_launcher.png",
        "packages/tauri/src-tauri/icons/dev/android/mipmap-xxhdpi/ic_launcher.png",
        "packages/tauri/src-tauri/icons/dev/ios/AppIcon-60x60@2x.png",
        "packages/tauri/src-tauri/icons/dev/ios/AppIcon-76x76@2x.png",
    ]

    for test_file in test_files:
        if os.path.exists(test_file):
            try:
                img = Image.open(test_file)
                img_rgba = img.convert("RGBA")
                pixels = list(img_rgba.getdata())

                # Find orange pixels
                orange_pixels = []
                for pixel in pixels[:100]:  # Check first 100 pixels
                    r, g, b, a = pixel
                    if a > 10 and not (r > 250 and g > 250 and b > 250):
                        orange_pixels.append((r, g, b))

                if orange_pixels:
                    avg_r = sum(p[0] for p in orange_pixels) // len(orange_pixels)
                    avg_g = sum(p[1] for p in orange_pixels) // len(orange_pixels)
                    avg_b = sum(p[2] for p in orange_pixels) // len(orange_pixels)

                    print(
                        f"{os.path.basename(test_file)}: RGB({avg_r}, {avg_g}, {avg_b})"
                    )

                    if (
                        250 <= avg_r <= 255
                        and 135 <= avg_g <= 145
                        and 65 <= avg_b <= 75
                    ):
                        print("  ✓ Correct darker orange")
                    else:
                        print("  ✗ Not correct color")
                else:
                    print(f"{os.path.basename(test_file)}: No orange pixels found")

            except Exception as e:
                print(f"{os.path.basename(test_file)}: Error - {e}")
        else:
            print(f"{test_file}: Not found")


if __name__ == "__main__":
    print("=== Updating Android and iOS Icons to Darker Orange ===")
    print("Target color: RGB(255, 140, 70) - #FF8C46")
    print("=" * 60)

    update_android_icons()
    update_ios_icons()
    check_results()

    print("\n=== UPDATE COMPLETE ===")
    print("All Android and iOS icons have been updated to darker orange!")
    print("\nUpdated directories:")
    print("1. packages/tauri/src-tauri/icons/dev/android/")
    print("2. packages/tauri/src-tauri/icons/dev/ios/")
    print("3. packages/tauri/src-tauri/icons/prod/android/")
    print("4. packages/tauri/src-tauri/icons/prod/ios/")
