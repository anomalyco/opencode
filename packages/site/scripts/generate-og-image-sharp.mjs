import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function generateOGImage() {
  const width = 1200;
  const height = 628;

  // Read the ASCII art image
  const asciiArtPath = path.join(__dirname, '..', 'public', 'images', 'agate-ascii-art.png');

  // Get the dimensions of the ASCII art
  const asciiArt = sharp(asciiArtPath);
  const metadata = await asciiArt.metadata();

  // Scale the ASCII art to desired width (500px)
  const desiredWidth = 500;
  const scaledHeight = Math.round((metadata.height / metadata.width) * desiredWidth);

  const scaledAsciiArt = await asciiArt
    .resize(desiredWidth, scaledHeight)
    .toBuffer();

  // Create SVG with text
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="#18181b"/>
      <text
        x="50%"
        y="420"
        text-anchor="middle"
        font-family="system-ui, -apple-system, sans-serif"
        font-size="48"
        font-weight="600"
        fill="white"
        style="line-height: 1.3;">
        <tspan x="50%" dy="0">Run and evaluate agents in parallel</tspan>
      </text>
    </svg>
  `;

  // Create base image with background and text
  const baseImage = await sharp(Buffer.from(svg))
    .png()
    .toBuffer();

  // Calculate position to center the ASCII art horizontally and position it higher up
  const asciiX = Math.round((width - desiredWidth) / 2);
  const asciiY = 140; // Position from top

  // Composite the ASCII art on top
  const finalImage = await sharp(baseImage)
    .composite([
      {
        input: scaledAsciiArt,
        top: asciiY,
        left: asciiX,
      },
    ])
    .png()
    .toBuffer();

  // Save the final image
  const outputPath = path.join(__dirname, '..', 'public', 'og-image.png');
  fs.writeFileSync(outputPath, finalImage);

  console.log('✅ OG image generated at public/og-image.png');
}

generateOGImage().catch(console.error);
