# ZFlow Icon Guide

## 🎨 Icon Design

The ZFlow icon features:
- **Letter Z** with flowing accent lines
- **Gradient background**: Indigo → Purple
- **Modern, clean aesthetic**
- **Glow effect** for depth

## 📦 Required Icon Formats

Tauri needs these icon files:
- `32x32.png` - Small icon
- `128x128.png` - Medium icon
- `128x128@2x.png` - High resolution (256x256)
- `icon.icns` - macOS icon
- `icon.ico` - Windows icon

## 🔧 Method 1: Online Converters (Easiest)

### Step 1: Convert SVG to PNG
1. Go to https://cloudconvert.com/svg-to-png
2. Upload `icon.svg`
3. Convert to **512x512 PNG**
4. Download

### Step 2: Resize to Required Sizes
Use https://www.iloveimg.com/resize-image to create:
- 32x32 PNG
- 128x128 PNG
- 256x256 PNG (for 128x128@2x)

### Step 3: Create .ico (Windows)
1. Go to https://convertio.co/png-ico/
2. Upload the 256x256 PNG
3. Download as `icon.ico`

### Step 4: Create .icns (macOS)
On macOS:
```bash
# Install iconutil (comes with Xcode)
mkdir icon.iconset
# Add your PNG files
cp 32x32.png icon.iconset/icon_16x16.png
cp 128x128.png icon.iconset/icon_128x128.png
cp 256x256.png icon.iconset/icon_256x256.png
# Create icns
iconutil -c icns icon.iconset
```

## 🔧 Method 2: Command Line (Advanced)

### Using ImageMagick
```bash
# Install ImageMagick
# Windows: choco install imagemagick
# macOS: brew install imagemagick

# Convert SVG to different sizes
magick icon.svg -resize 32x32 32x32.png
magick icon.svg -resize 128x128 128x128.png
magick icon.svg -resize 256x256 128x128@2x.png

# Create ICO (Windows)
magick icon.svg -define icon:auto-resize=256,128,96,64,48,32,16 icon.ico

# Create ICNS (macOS only - requires iconutil)
# Use online method for .icns
```

### Using Sharp (Node.js)
```bash
npm install -g sharp-ico
sharp-ico icon.svg --out .
```

## 🔧 Method 3: Design Software

### Using Figma (Recommended)
1. Import `icon.svg` into Figma
2. Use plugins to export:
   - "Iconify" plugin
   - "TinyPNG" plugin for compression
3. Export at multiple sizes

### Using GIMP (Free)
1. Open SVG in GIMP
2. Export as PNG at different sizes
3. Use .ico plugin for Windows icon

## 📁 File Placement

After generating all icons, place them in:
```
packages/desktop/src-tauri/icons/zflow/
├── 32x32.png
├── 128x128.png
├── 128x128@2x.png
├── icon.ico
├── icon.icns (macOS only)
└── icon.svg (source file - already created)
```

## ✅ Quick Start (Recommended Workflow)

1. **Use Online Tools:**
   - SVG → 512px PNG: https://cloudconvert.com/svg-to-png
   - Resize to required sizes: https://www.iloveimg.com/resize-image
   - PNG → ICO: https://convertio.co/png-ico/

2. **For macOS ICNS:**
   - Use a Mac or online tool like https://cloudconvert.com/png-icns

3. **Place all files in the icons/zflow directory**

4. **Verify icons are working:**
   ```bash
   cd .worktrees/zflow
   bun run tauri build
   # Check if icons appear in the built app
   ```

## 🎨 Alternative: Use an Icon Generator

**Online icon generators that work from SVG:**
- https://favicon.io/ (generates all formats from SVG)
- https://realfavicongenerator.net/
- https://www.favicon-generator.org/

**Desktop apps:**
- **Windows**:.icofx (free, https://icofx.ro/)
- **macOS**: Icon Slate (paid)

## 🚀 After Adding Icons

Commit them to git:
```bash
git add packages/desktop/src-tauri/icons/zflow/
git commit -m "feat: add ZFlow icons"
```

## 💡 Pro Tips

1. **Test icons at different sizes** - Make sure the Z is readable even at 32x32
2. **Keep the SVG source** - You can regenerate icons if needed
3. **Use consistent colors** - The gradient matches the app theme
4. **Icon should work on light/dark backgrounds** - Test in both modes

---

**Need help?** The SVG source file is already created. Just convert it to the required formats!
