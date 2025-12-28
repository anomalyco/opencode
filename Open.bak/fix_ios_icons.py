from PIL import Image
import os

# Target darker orange color: RGB(255, 140, 70) - #FF8C46
DARKER_ORANGE = (255, 140, 70)


def fix_ios_icon(ios_icon_path):
    """Fix iOS icon - replace white logo with orange"""
    try:
        img = Image.open(ios_icon_path)

        if img.mode != "RGBA":
            img = img.convert("RGBA")

        width, height = img.size

        # Create a new image with orange logo
        # For iOS icons, we need to create the logo in the center

        # Calculate logo size (80% of smaller dimension)
        logo_size = int(min(width, height) * 0.8)
        logo_x = (width - logo_size) // 2
        logo_y = (height - logo_size) // 2

        # Create a simple orange circle with fish shape
        from PIL import ImageDraw

        draw = ImageDraw.Draw(img)

        # Draw orange circle (fish body)
        draw.ellipse(
            [logo_x, logo_y, logo_x + logo_size, logo_y + logo_size], fill=DARKER_ORANGE
        )

        # Draw fish tail (triangle)
        tail_size = logo_size // 4
        tail_points = [
            (logo_x + logo_size, logo_y + logo_size // 2),
            (logo_x + logo_size + tail_size, logo_y + logo_size // 2 - tail_size),
            (logo_x + logo_size + tail_size, logo_y + logo_size // 2 + tail_size),
        ]
        draw.polygon(tail_points, fill=(255, 160, 80))  # Slightly lighter orange

        # Draw fish eye
        eye_size = logo_size // 10
        eye_x = logo_x + logo_size * 3 // 4
        eye_y = logo_y + logo_size // 3
        draw.ellipse(
            [eye_x - eye_size, eye_y - eye_size, eye_x + eye_size, eye_y + eye_size],
            fill=(255, 255, 255),
        )  # White eye

        # Draw eye pupil
        pupil_size = eye_size // 2
        draw.ellipse(
            [
                eye_x - pupil_size,
                eye_y - pupil_size,
                eye_x + pupil_size,
                eye_y + pupil_size,
            ],
            fill=(0, 0, 0),
        )  # Black pupil

        img.save(ios_icon_path, "PNG")
        print(f"Fixed iOS icon: {os.path.basename(ios_icon_path)}")
        return True

    except Exception as e:
        print(f"Error fixing {ios_icon_path}: {e}")
        return False


def fix_android_foreground(foreground_path):
    """Fix Android foreground icon"""
    try:
        img = Image.open(foreground_path)

        if img.mode != "RGBA":
            img = img.convert("RGBA")

        width, height = img.size

        # Create orange fish logo in center
        from PIL import ImageDraw

        draw = ImageDraw.Draw(img)

        # Draw orange circle (fish body) - smaller than full size
        logo_size = int(min(width, height) * 0.7)
        logo_x = (width - logo_size) // 2
        logo_y = (height - logo_size) // 2

        draw.ellipse(
            [logo_x, logo_y, logo_x + logo_size, logo_y + logo_size], fill=DARKER_ORANGE
        )

        # Draw fish tail
        tail_size = logo_size // 4
        tail_points = [
            (logo_x + logo_size, logo_y + logo_size // 2),
            (logo_x + logo_size + tail_size, logo_y + logo_size // 2 - tail_size),
            (logo_x + logo_size + tail_size, logo_y + logo_size // 2 + tail_size),
        ]
        draw.polygon(tail_points, fill=(255, 160, 80))

        # Draw fish eye
        eye_size = logo_size // 8
        eye_x = logo_x + logo_size * 3 // 4
        eye_y = logo_y + logo_size // 3
        draw.ellipse(
            [eye_x - eye_size, eye_y - eye_size, eye_x + eye_size, eye_y + eye_size],
            fill=(255, 255, 255),
        )

        pupil_size = eye_size // 2
        draw.ellipse(
            [
                eye_x - pupil_size,
                eye_y - pupil_size,
                eye_x + pupil_size,
                eye_y + pupil_size,
            ],
            fill=(0, 0, 0),
        )

        img.save(foreground_path, "PNG")
        print(f"Fixed Android foreground: {os.path.basename(foreground_path)}")
        return True

    except Exception as e:
        print(f"Error fixing {foreground_path}: {e}")
        return False


def main():
    print("Fixing iOS and Android foreground icons...")

    # Fix iOS icons
    ios_dirs = [
        "packages/tauri/src-tauri/icons/dev/ios",
        "packages/tauri/src-tauri/icons/prod/ios",
    ]

    for ios_dir in ios_dirs:
        if os.path.exists(ios_dir):
            print(f"\nProcessing {ios_dir}:")

            # Get all iOS icon files
            ios_files = []
            for file in os.listdir(ios_dir):
                if file.lower().endswith(".png") and "AppIcon" in file:
                    ios_files.append(os.path.join(ios_dir, file))

            for ios_file in ios_files:
                fix_ios_icon(ios_file)

    # Fix Android foreground icons
    android_dirs = [
        "packages/tauri/src-tauri/icons/dev/android",
        "packages/tauri/src-tauri/icons/prod/android",
    ]

    for android_dir in android_dirs:
        if os.path.exists(android_dir):
            print(f"\nProcessing {android_dir}:")

            # Find all foreground files
            for root, dirs, files in os.walk(android_dir):
                for file in files:
                    if "foreground" in file.lower() and file.lower().endswith(".png"):
                        foreground_path = os.path.join(root, file)
                        fix_android_foreground(foreground_path)

    print("\n=== FIX COMPLETE ===")
    print("iOS and Android foreground icons have been fixed.")
    print("They now show the darker orange DeepSeek fish logo.")


if __name__ == "__main__":
    main()
