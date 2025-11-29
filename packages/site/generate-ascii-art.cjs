const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

// Read the ASCII art
const asciiArt = fs.readFileSync(path.join(__dirname, 'src', 'ascii-logo.txt'), 'utf-8');

// Create canvas
const fontSize = 16;
const lineHeight = fontSize * 1.2;
const lines = asciiArt.split('\n');
const maxWidth = Math.max(...lines.map(line => line.length));

const canvas = createCanvas(maxWidth * fontSize * 0.6, lines.length * lineHeight);
const ctx = canvas.getContext('2d');

// Set background
ctx.fillStyle = '#18181b'; // zinc-900
ctx.fillRect(0, 0, canvas.width, canvas.height);

// Set text style
ctx.font = `${fontSize}px "JetBrains Mono", "Courier New", monospace`;
ctx.fillStyle = '#FF6600'; // Orange color for Forge branding
ctx.textBaseline = 'top';

// Draw each line
lines.forEach((line, index) => {
  ctx.fillText(line, 10, index * lineHeight);
});

// Save to file
const buffer = canvas.toBuffer('image/png');
fs.writeFileSync(path.join(__dirname, 'public', 'images', 'forge-ascii-art.png'), buffer);

console.log('Forge ASCII art PNG generated successfully!');
