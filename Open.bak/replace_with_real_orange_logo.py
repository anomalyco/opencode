from PIL import Image
import os
import shutil


def replace_with_real_orange_logo():
    """Replace Android and iOS icons with the real orange DeepSeek logo"""
    print("=== Replacing with Real Orange DeepSeek Logo ===")

    # Source: The real orange DeepSeek logo we created earlier
    source_logo_path = "packages/tauri/src-tauri/icons/dev/128x128.png"

    if not os.path.exists(source_logo_path):
        print(f"Error: Source logo not found: {source_logo_path}")
        return

    # Open source logo to verify
    source_img = Image.open(source_logo_path)
    print(f"Source logo: {source_img.size}, mode: {source_img.mode}")

    # Directories to update
    directories = [
        "packages/tauri/src-tauri/icons/dev/android",
        "packages/tauri/src-tauri/icons/dev/ios",
        "packages/tauri/src-tauri/icons/prod/android",
        "packages/tauri/src-tauri/icons/prod/ios",
    ]

    total_updated = 0

    for directory in directories:
        if not os.path.exists(directory):
            print(f"\nDirectory not found: {directory}")
            continue

        print(f"\nProcessing: {directory}")

        # Find all PNG files
        png_files = []
        for root, dirs, files in os.walk(directory):
            for file in files:
                if file.lower().endswith(".png"):
                    png_files.append(os.path.join(root, file))

        print(f"Found {len(png_files)} PNG files")

        # Update each file
        for png_file in png_files:
            try:
                # Get target size
                target_img = Image.open(png_file)
                target_size = target_img.size
                target_img.close()

                # Resize source logo to target size
                resized_logo = source_img.resize(target_size, Image.Resampling.LANCZOS)

                # Save to target file
                resized_logo.save(png_file, "PNG")

                print(
                    f"  ✓ Updated: {os.path.basename(png_file)} ({target_size[0]}x{target_size[1]})"
                )
                total_updated += 1

            except Exception as e:
                print(f"  ✗ Error updating {os.path.basename(png_file)}: {e}")

    source_img.close()

    print(f"\n=== SUMMARY ===")
    print(f"Total files updated: {total_updated}")
    print(f"Source logo used: {source_logo_path}")
    print("\nAll Android and iOS icons now use the REAL orange DeepSeek logo!")

    # Verify a few files
    print("\n=== VERIFICATION ===")
    test_files = [
        "packages/tauri/src-tauri/icons/dev/android/mipmap-hdpi/ic_launcher.png",
        "packages/tauri/src-tauri/icons/dev/ios/AppIcon-60x60@2x.png",
        "packages/tauri/src-tauri/icons/prod/android/mipmap-hdpi/ic_launcher.png",
        "packages/tauri/src-tauri/icons/prod/ios/AppIcon-60x60@2x.png",
    ]

    for test_file in test_files:
        if os.path.exists(test_file):
            img = Image.open(test_file)
            print(f"{os.path.basename(test_file)}: {img.size}")
            img.close()
        else:
            print(f"{test_file}: Not found")


if __name__ == "__main__":
    replace_with_real_orange_logo()
