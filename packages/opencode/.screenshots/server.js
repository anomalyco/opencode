#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8765;
const UPLOAD_DIR = __dirname;

const html = fs.readFileSync(path.join(__dirname, 'dropzone.html'), 'utf8')
  .replace('alert(`📁 File will be downloaded', 'uploadToServer(file, filename); return; alert(`📁 File will be downloaded');

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html + `
      <script>
        async function uploadToServer(file, filename) {
          const formData = new FormData();
          formData.append('file', file, filename);
          
          try {
            const response = await fetch('http://localhost:${PORT}/upload', {
              method: 'POST',
              body: formData
            });
            
            if (response.ok) {
              success.style.display = 'block';
              setTimeout(() => success.style.display = 'none', 3000);
            }
          } catch (err) {
            alert('Upload failed: ' + err.message);
          }
        }
      </script>
    `);
    return;
  }

  if (req.method === 'POST' && req.url === '/upload') {
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      const buffer = Buffer.concat(body);
      const boundary = req.headers['content-type'].split('boundary=')[1];
      
      // Parse multipart form data
      const parts = buffer.toString('binary').split(`--${boundary}`);
      
      for (const part of parts) {
        if (part.includes('filename=')) {
          const filenameMatch = part.match(/filename="([^"]+)"/);
          if (!filenameMatch) continue;
          
          const filename = filenameMatch[1];
          const dataStart = part.indexOf('\r\n\r\n') + 4;
          const dataEnd = part.lastIndexOf('\r\n');
          const fileData = part.substring(dataStart, dataEnd);
          
          const filepath = path.join(UPLOAD_DIR, filename);
          fs.writeFileSync(filepath, fileData, 'binary');
          
          console.log(`✅ Saved: ${filename}`);
          console.log(`📁 Location: .screenshots/${filename}`);
          console.log(`💬 Tell AI: "check .screenshots/${filename}"\n`);
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, filename }));
          return;
        }
      }
      
      res.writeHead(400);
      res.end('No file uploaded');
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n🎯 Screenshot Dropzone Server`);
  console.log(`📡 Open: http://localhost:${PORT}`);
  console.log(`📁 Saving to: ${UPLOAD_DIR}`);
  console.log(`\n👉 Drag images to the browser to save them!\n`);
});
