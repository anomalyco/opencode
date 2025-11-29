import { ImageResponse } from '@vercel/og';
import fs from 'fs';
import path from 'path';
import { createElement } from 'react';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function generateOGImage() {
  // Read the ASCII art image and convert to data URI
  const asciiArtPath = path.join(__dirname, '..', 'public', 'images', 'forge-ascii-art.png');
  const asciiArtBuffer = fs.readFileSync(asciiArtPath);
  const asciiArtBase64 = asciiArtBuffer.toString('base64');

  const imageResponse = new ImageResponse(
    createElement(
      'div',
      {
        style: {
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#18181b',
          padding: '80px 60px',
        },
      },
      [
        // Use a div with background image instead of img tag
        createElement('div', {
          key: 'logo',
          style: {
            width: '500px',
            height: '100px',
            backgroundImage: `url(data:image/png;base64,${asciiArtBase64})`,
            backgroundSize: 'contain',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center',
            marginBottom: '40px',
          },
        }),
        createElement(
          'div',
          {
            key: 'tagline',
            style: {
              fontSize: 48,
              fontWeight: 600,
              color: 'white',
              textAlign: 'center',
              lineHeight: 1.3,
              maxWidth: '900px',
            },
          },
          'Terminal command center for coding agents'
        ),
      ]
    ),
    {
      width: 1200,
      height: 628,
    }
  );

  const arrayBuffer = await imageResponse.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const outputPath = path.join(__dirname, '..', 'public', 'og-image.png');
  fs.writeFileSync(outputPath, buffer);

  console.log('✅ OG image generated at public/og-image.png');
}

generateOGImage().catch(console.error);
