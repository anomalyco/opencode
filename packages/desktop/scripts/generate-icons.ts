import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { $ } from "bun"
import sharp from "sharp"
import png2icons from "png2icons"
import { type Channel, resolveChannel } from "./utils"

interface BadgeConfig {
  text: string
  color: string
}

interface FileHash {
  path: string
  sha256: string
  size: number
}

interface Manifest {
  channel: Channel
  generatedAt: string
  files: FileHash[]
}

// ── Constants ──────────────────────────────────────────────────────────

const ICONS_DIR = "icons"
const SEED_DIR = path.join(ICONS_DIR, "seed")
const BADGE_THRESHOLD = 32 // px, images below this skip badge

const BADGE_CONFIG: Record<Channel, BadgeConfig | null> = {
  prod: null,
  dev: { text: "DEV", color: "#00CC66" },
  beta: { text: "BETA", color: "#FFB800" },
}

// ── Seed file definitions ──────────────────────────────────────────────

interface SeedFile {
  name: string
  path: string
  detail: "full" | "medium" | "silhouette"
}

const SEEDS: SeedFile[] = [
  { name: "octopus-mark-square.svg", detail: "full", path: path.join(SEED_DIR, "octopus-mark-square.svg") },
  { name: "octopus-mark-medium.svg", detail: "medium", path: path.join(SEED_DIR, "octopus-mark-medium.svg") },
  { name: "octopus-mark-silhouette.svg", detail: "silhouette", path: path.join(SEED_DIR, "octopus-mark-silhouette.svg") },
]

// ── CLI / Env ──────────────────────────────────────────────────────────

const DRY_RUN = process.env.OCTOPUS_DRY_RUN === "1"

// ── Helpers ────────────────────────────────────────────────────────────

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex")
}

function logDryRun(msg: string) {
  if (DRY_RUN) console.log(`[DRY-RUN] ${msg}`)
}

function logPlannedFile(relativePath: string, sourceHint: string) {
  logDryRun(`Would generate: ${relativePath} (from ${sourceHint})`)
}

function loadSeedSvg(detail: "full" | "medium" | "silhouette"): Buffer | null {
  const seed = SEEDS.find((s) => s.detail === detail)
  if (!seed) return null
  if (fs.existsSync(seed.path)) {
    const svg = fs.readFileSync(seed.path, "utf-8")
    // Replace currentColor with black for rendering
    return Buffer.from(svg.replace(/currentColor/g, "#000000"))
  }
  return null
}

// Graceful fallback: if medium/silhouette seed is missing, use the full seed
function resolveSeedSvg(forSize: number): Buffer {
  const detail: "full" | "medium" | "silhouette" =
    forSize >= 256 ? "full" : forSize >= 32 ? "medium" : "silhouette"

  const svg = loadSeedSvg(detail) ?? loadSeedSvg("full")
  if (!svg) throw new Error(`No seed SVG available (tried ${detail}, then full)`)
  return svg
}

// ── Badge ──────────────────────────────────────────────────────────────

async function applyBadge(sourceBuf: Buffer, size: number, config: BadgeConfig): Promise<Buffer> {
  if (size < BADGE_THRESHOLD) return sourceBuf

  const badgeSvg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect
      x="${size * 0.6}" y="${size * 0.7}"
      width="${size * 0.35}" height="${size * 0.25}"
      rx="${size * 0.03}"
      fill="${config.color}"
      opacity="0.92"
    />
    <text
      x="${size * 0.775}" y="${size * 0.86}"
      fill="white"
      font-family="-apple-system, sans-serif"
      font-size="${size * 0.12}"
      font-weight="bold"
      text-anchor="middle"
      dominant-baseline="central"
    >${config.text}</text>
  </svg>`

  return sharp(sourceBuf)
    .composite([{ input: Buffer.from(badgeSvg), top: 0, left: 0 }])
    .png()
    .toBuffer()
}

// ── Base PNG generation ───────────────────────────────────────────────

interface BasePng {
  size: number
  buffer: Buffer
}

async function generateBasePngs(channel: Channel): Promise<BasePng[]> {
  const badge = BADGE_CONFIG[channel]
  const sizes = [1024, 512, 256, 128, 64, 48, 40, 32, 29, 20, 16]

  const results: BasePng[] = []

  for (const size of sizes) {
    const svgBuf = resolveSeedSvg(size)
    logPlannedFile(`base_${size}x${size}.png`, `seed → ${size}×${size}`)

    let png = await sharp(svgBuf).resize(size, size).png().toBuffer()

    if (badge) {
      png = await applyBadge(png, size, badge)
    }

    results.push({ size, buffer: png })
  }

  return results
}

// ── Platform generators ───────────────────────────────────────────────

async function generateMacOs(
  basePngs: BasePng[],
  tmpDir: string,
  manifest: Manifest,
  channel: Channel,
) {
  // icon.icns
  const p1024 = basePngs.find((p) => p.size === 1024)!
  logPlannedFile(`${channel}/icon.icns`, `square.svg → 1024×1024 → png2icons`)

  const icnsBuf = png2icons.createICNS(p1024.buffer, png2icons.BICUBIC, true)
  if (icnsBuf) {
    const icnsPath = path.join(tmpDir, "icon.icns")
    if (!DRY_RUN) await Bun.write(icnsPath, icnsBuf)
    manifest.files.push({ path: "icon.icns", sha256: sha256(icnsBuf), size: icnsBuf.length })
    console.log(`  ✓ icon.icns (${icnsBuf.length} bytes)`)
  } else {
    console.warn("  ⚠ png2icons.createICNS returned null")
  }

  // icon.png 512×512
  const p512 = basePngs.find((p) => p.size === 512)!
  logPlannedFile(`${channel}/icon.png`, `square.svg → 512×512`)
  const iconPng = path.join(tmpDir, "icon.png")
  if (!DRY_RUN) await Bun.write(iconPng, p512.buffer)
  manifest.files.push({ path: "icon.png", sha256: sha256(p512.buffer), size: p512.buffer.length })
  console.log(`  ✓ icon.png (${p512.buffer.length} bytes)`)

  // dock.png 256×256
  const p256 = basePngs.find((p) => p.size === 256)!
  logPlannedFile(`${channel}/dock.png`, `medium.svg → 256×256`)
  const dockPng = path.join(tmpDir, "dock.png")
  if (!DRY_RUN) await Bun.write(dockPng, p256.buffer)
  manifest.files.push({ path: "dock.png", sha256: sha256(p256.buffer), size: p256.buffer.length })
  console.log(`  ✓ dock.png (${p256.buffer.length} bytes)`)
}

async function generateWindowsIco(
  basePngs: BasePng[],
  tmpDir: string,
  manifest: Manifest,
  channel: Channel,
) {
  // icon.ico - use png2icons with 256x256 as source (png2icons generates multi-res internally)
  const p256 = basePngs.find((p) => p.size === 256)!.buffer
  logPlannedFile(`${channel}/icon.ico`, `medium.svg → 256×256 → png2icons`)

  const icoBuf = png2icons.createICO(p256, png2icons.BICUBIC, false)
  if (icoBuf) {
    const icoPath = path.join(tmpDir, "icon.ico")
    if (!DRY_RUN) await Bun.write(icoPath, icoBuf)
    manifest.files.push({ path: "icon.ico", sha256: sha256(icoBuf), size: icoBuf.length })
    console.log(`  ✓ icon.ico (${icoBuf.length} bytes)`)
  } else {
    console.warn("  ⚠ png2icons.createICO returned null")
  }
}

async function generateUwp(
  basePngs: BasePng[],
  tmpDir: string,
  manifest: Manifest,
) {
  const uwpFiles: Array<{ name: string; size: number }> = [
    { name: "Square30x30Logo.png", size: 30 },
    { name: "Square44x44Logo.png", size: 44 },
    { name: "Square71x71Logo.png", size: 71 },
    { name: "Square89x89Logo.png", size: 89 },
    { name: "Square107x107Logo.png", size: 107 },
    { name: "Square142x142Logo.png", size: 142 },
    { name: "Square150x150Logo.png", size: 150 },
    { name: "Square284x284Logo.png", size: 284 },
    { name: "Square310x310Logo.png", size: 310 },
    { name: "StoreLogo.png", size: 50 },
    { name: "32x32.png", size: 32 },
    { name: "64x64.png", size: 64 },
    { name: "128x128.png", size: 128 },
    { name: "128x128@2x.png", size: 256 },
  ]

  for (const f of uwpFiles) {
    const svgBuf = resolveSeedSvg(f.size)
    logPlannedFile(`uwp/${f.name}`, `seed → ${f.size}×${f.size}`)

    let png = await sharp(svgBuf).resize(f.size, f.size).png().toBuffer()
    const dst = path.join(tmpDir, f.name)
    if (!DRY_RUN) await Bun.write(dst, png)
    manifest.files.push({ path: f.name, sha256: sha256(png), size: png.length })
    console.log(`  ✓ ${f.name} (${png.length} bytes)`)
  }
}

async function generateIos(
  basePngs: BasePng[],
  tmpDir: string,
  manifest: Manifest,
) {
  const iosFiles: Array<{ name: string; size: number }> = [
    { name: "AppIcon-20x20@1x.png", size: 20 },
    { name: "AppIcon-20x20@2x.png", size: 40 },
    { name: "AppIcon-20x20@2x-1.png", size: 40 },
    { name: "AppIcon-20x20@3x.png", size: 60 },
    { name: "AppIcon-29x29@1x.png", size: 29 },
    { name: "AppIcon-29x29@2x.png", size: 58 },
    { name: "AppIcon-29x29@2x-1.png", size: 58 },
    { name: "AppIcon-29x29@3x.png", size: 87 },
    { name: "AppIcon-40x40@1x.png", size: 40 },
    { name: "AppIcon-40x40@2x.png", size: 80 },
    { name: "AppIcon-40x40@2x-1.png", size: 80 },
    { name: "AppIcon-40x40@3x.png", size: 120 },
    { name: "AppIcon-60x60@2x.png", size: 120 },
    { name: "AppIcon-60x60@3x.png", size: 180 },
    { name: "AppIcon-76x76@1x.png", size: 76 },
    { name: "AppIcon-76x76@2x.png", size: 152 },
    { name: "AppIcon-83.5x83.5@2x.png", size: 167 },
    { name: "AppIcon-512@2x.png", size: 1024 },
  ]

  const iosDir = path.join(tmpDir, "ios")
  if (!DRY_RUN) fs.mkdirSync(iosDir, { recursive: true })

  for (const f of iosFiles) {
    const svgBuf = resolveSeedSvg(f.size)
    logPlannedFile(`ios/${f.name}`, `seed → ${f.size}×${f.size}`)

    let png = await sharp(svgBuf).resize(f.size, f.size).png().toBuffer()
    const dst = path.join(iosDir, f.name)
    if (!DRY_RUN) await Bun.write(dst, png)
    manifest.files.push({ path: `ios/${f.name}`, sha256: sha256(png), size: png.length })
    console.log(`  ✓ ios/${f.name} (${png.length} bytes)`)
  }
}

async function generateAndroid(
  basePngs: BasePng[],
  tmpDir: string,
  manifest: Manifest,
  channel: Channel,
) {
  // Android density → base size mapping
  const densities: Array<{ dir: string; size: number }> = [
    { dir: "mipmap-mdpi", size: 48 },
    { dir: "mipmap-hdpi", size: 72 },
    { dir: "mipmap-xhdpi", size: 96 },
    { dir: "mipmap-xxhdpi", size: 144 },
    { dir: "mipmap-xxxhdpi", size: 192 },
  ]

  const androidDir = path.join(tmpDir, "android")
  if (!DRY_RUN) fs.mkdirSync(androidDir, { recursive: true })

  for (const density of densities) {
    const subDir = path.join(androidDir, density.dir)
    if (!DRY_RUN) fs.mkdirSync(subDir, { recursive: true })

    const svgBuf = resolveSeedSvg(density.size)

    for (const variant of ["ic_launcher.png", "ic_launcher_foreground.png", "ic_launcher_round.png"]) {
      logPlannedFile(`android/${density.dir}/${variant}`, `seed → ${density.size}×${density.size}`)

      let png = await sharp(svgBuf).resize(density.size, density.size).png().toBuffer()
      const dst = path.join(subDir, variant)
      if (!DRY_RUN) await Bun.write(dst, png)
      manifest.files.push({ path: `android/${density.dir}/${variant}`, sha256: sha256(png), size: png.length })
      console.log(`  ✓ android/${density.dir}/${variant} (${png.length} bytes)`)
    }
  }

  // Preserve existing Android XML files (adaptive icon defs)
  const existingXmlFiles = [
    "android/mipmap-anydpi-v26/ic_launcher.xml",
    "android/values/ic_launcher_background.xml",
  ]

  for (const xmlRel of existingXmlFiles) {
    const srcXml = path.join(ICONS_DIR, channel, xmlRel)
    if (fs.existsSync(srcXml)) {
      const content = fs.readFileSync(srcXml)
      const dstXml = path.join(tmpDir, xmlRel)
      if (!DRY_RUN) {
        fs.mkdirSync(path.dirname(dstXml), { recursive: true })
        fs.writeFileSync(dstXml, content)
      }
      manifest.files.push({ path: xmlRel, sha256: sha256(content), size: content.length })
      console.log(`  ✓ ${xmlRel} (copied from existing, ${content.length} bytes)`)
    } else {
      // Generate the XML defaults if none exist
      const defaultContent = xmlRel.endsWith("ic_launcher.xml")
        ? `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n  <background android:drawable="@color/ic_launcher_background"/>\n</adaptive-icon>\n`
        : `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <color name="ic_launcher_background">#fff</color>\n</resources>\n`

      const dstXml = path.join(tmpDir, xmlRel)
      if (!DRY_RUN) {
        fs.mkdirSync(path.dirname(dstXml), { recursive: true })
        fs.writeFileSync(dstXml, defaultContent)
      }
      const buf = Buffer.from(defaultContent)
      manifest.files.push({ path: xmlRel, sha256: sha256(buf), size: buf.length })
      console.log(`  ✓ ${xmlRel} (generated default, ${buf.length} bytes)`)
    }
  }
}

// ── Atomic write ───────────────────────────────────────────────────────

async function atomicWrite(channel: Channel, tmpDir: string) {
  const targetDir = path.join(ICONS_DIR, channel)
  console.log(`\n  → Atomic move: ${tmpDir} → ${targetDir}`)

  if (!DRY_RUN) {
    await $`rm -rf ${targetDir}`
    await $`mv ${tmpDir} ${targetDir}`
    console.log(`  ✓ Moved to ${targetDir}`)
  } else {
    console.log(`  [DRY-RUN] Would move ${tmpDir} → ${targetDir}`)
  }
}

// ── Print manifest ─────────────────────────────────────────────────────

function printManifest(manifest: Manifest) {
  console.log(`\n=== Icon Manifest (${manifest.channel}) ===`)
  console.log(`Generated at: ${manifest.generatedAt}`)
  console.log(`Total files: ${manifest.files.length}`)
  console.log("")
  for (const entry of manifest.files) {
    console.log(`${entry.sha256}  ${entry.path}  (${entry.size} bytes)`)
  }
}

// ── Linux icon generator ────────────────────────────────────────────────
//
// Linux uses the Freedesktop.org icon theme spec (hicolor).
// Icons must be square PNGs at standard sizes, WITHOUT rounded corners.
// See: https://specifications.freedesktop.org/icon-theme-spec/latest/
//
// We generate a minimal set; a full hicolor theme could be added later.

interface LinuxIcon {
  name: string   // e.g. "octopus.png" — in a real .desktop file this is the icon name
  size: number
}

const LINUX_ICONS: LinuxIcon[] = [
  // Standard hicolor sizes for application icons
  { name: "16x16/apps/octopus.png",   size: 16 },
  { name: "22x22/apps/octopus.png",   size: 22 },
  { name: "24x24/apps/octopus.png",   size: 24 },
  { name: "32x32/apps/octopus.png",   size: 32 },
  { name: "48x48/apps/octopus.png",   size: 48 },
  { name: "64x64/apps/octopus.png",   size: 64 },
  { name: "128x128/apps/octopus.png", size: 128 },
  { name: "256x256/apps/octopus.png", size: 256 },
  { name: "512x512/apps/octopus.png", size: 512 },
]

async function generateLinuxIcons(
  tmpDir: string,
  manifest: Manifest,
) {
  const linuxBase = path.join(tmpDir, "linux", "hicolor")
  if (!DRY_RUN) fs.mkdirSync(linuxBase, { recursive: true })

  for (const icon of LINUX_ICONS) {
    const svgBuf = resolveSeedSvg(icon.size)
    const png = await sharp(svgBuf).resize(icon.size, icon.size).png().toBuffer()
    const dst = path.join(linuxBase, icon.name)
    if (!DRY_RUN) {
      fs.mkdirSync(path.dirname(dst), { recursive: true })
      await Bun.write(dst, png)
    }
    manifest.files.push({ path: `linux/hicolor/${icon.name}`, sha256: sha256(png), size: png.length })
    console.log(`  ✓ linux/hicolor/${icon.name} (${png.length} bytes)`)
  }
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  const channel = resolveChannel()
  console.log(`\n🔨 Generating icons for channel: ${channel}${DRY_RUN ? " (DRY-RUN)" : ""}`)

  const badge = BADGE_CONFIG[channel]
  if (badge) {
    console.log(`   Badge: "${badge.text}" (${badge.color}), threshold: ${BADGE_THRESHOLD}px`)
  }

  // Check seeds
  const seedsPresent = SEEDS.filter((s) => fs.existsSync(s.path))
  const seedsMissing = SEEDS.filter((s) => !fs.existsSync(s.path))
  console.log(`   Seeds: ${seedsPresent.length}/3 present`)
  for (const s of seedsMissing) {
    console.log(`   ⚠ Seed missing: ${s.name} — will use fallback`)
  }

  const manifest: Manifest = {
    channel,
    generatedAt: new Date().toISOString(),
    files: [],
  }

  const tmpDir = path.join(ICONS_DIR, `.tmp-${channel}`)

  if (!DRY_RUN) {
    // Clean any stale temp dir
    await $`rm -rf ${tmpDir}`
    fs.mkdirSync(tmpDir, { recursive: true })
  }

  // 1. Generate base PNGs
  console.log("\n── Base PNGs ──")
  const basePngs = await generateBasePngs(channel)

  // 2. macOS
  console.log("\n── macOS ──")
  await generateMacOs(basePngs, tmpDir, manifest, channel)

  // 3. Windows
  console.log("\n── Windows ──")
  await generateWindowsIco(basePngs, tmpDir, manifest, channel)

  // 4. UWP
  console.log("\n── UWP ──")
  await generateUwp(basePngs, tmpDir, manifest)

  // 5. iOS
  console.log("\n── iOS ──")
  await generateIos(basePngs, tmpDir, manifest)

  // 6. Android
  console.log("\n── Android ──")
  await generateAndroid(basePngs, tmpDir, manifest, channel)

  // 7. Linux
  console.log("\n── Linux ──")
  await generateLinuxIcons(tmpDir, manifest)

  // 8. Print manifest
  printManifest(manifest)

  // 9. Write manifest file
  if (!DRY_RUN) {
    const manifestPath = path.join(tmpDir, ".icon-manifest.json")
    await Bun.write(manifestPath, JSON.stringify(manifest, null, 2))
    console.log(`\n   Manifest written: ${manifestPath}`)
  }

  // 11. Atomic move — all-or-nothing: temp dir fully populated before swap
  await atomicWrite(channel, tmpDir)

  console.log(`\n✅ Done. ${manifest.files.length} files generated for channel "${channel}".`)
}

main().catch((err) => {
  // Batch rollback: on ANY failure, discard the entire temp directory
  // The target directory remains unchanged (no partial output).
  const channel = process.env.OCTOPUS_CHANNEL ?? "prod"
  const tmpDir = path.join(ICONS_DIR, `.tmp-${channel}`)
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    console.log(`\n  🧹 Rollback: removed partial temp dir ${tmpDir}`)
  } catch {
    // Temp dir may not exist yet — that's fine
  }
  console.error("\n❌ Error:", err)
  process.exit(1)
})
