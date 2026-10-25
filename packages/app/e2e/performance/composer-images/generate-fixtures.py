"""Generate synthetic artwork without including user files. Requires Pillow."""
from pathlib import Path
import sys
from PIL import Image, ImageDraw

output = Path(sys.argv[1])
output.mkdir(parents=True, exist_ok=True)
for name, size, alternate in [
    ("large", (17901, 10654), False),
    ("medium", (8858, 7228), False),
    ("medium2", (8858, 7228), True),
    ("small", (1440, 900), False),
]:
    image = Image.new("RGB", size, "#fffbe8")
    draw = ImageDraw.Draw(image)
    for y in range(0, size[1], 64):
        for x in range(0, size[0], 64):
            color = (
                (x // 64 * (53 if alternate else 37)) % 256,
                (y // 64 * (37 if alternate else 53)) % 256,
                (x + y + (31 if alternate else 0)) % 256,
            )
            draw.rectangle((x, y, x + 31, y + 31), fill=color)
    path = output / (name + ".jpg")
    image.save(path, quality=90)
    image.close()
    print(name, size, path.stat().st_size)
