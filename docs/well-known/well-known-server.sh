#!/usr/bin/env bash
# well-known-server.sh — Sirve el endpoint .well-known/opencode
# Uso: ./well-known-server.sh [port] [domain]
# Default: port 8080, sirve docs/well-known/ como raíz

set -euo pipefail

PORT="${1:-8080}"
DOMAIN="${2:-localhost}"
ROOT="$(dirname "$0")"

echo "🚀 gentle-opencode config server"
echo "   URL: http://${DOMAIN}:${PORT}"
echo "   Config: http://${DOMAIN}:${PORT}/.well-known/opencode"
echo "   Status: http://${DOMAIN}:${PORT}/health"
echo ""
echo "   Para probar: curl http://localhost:${PORT}/.well-known/opencode | jq"
echo ""

# Servir archivos estáticos con Python (sin dependencias extra)
# El directorio raíz tiene la estructura .well-known/opencode -> opencode.json

cleanup() {
  echo ""
  echo "🛑 Servidor detenido."
}
trap cleanup EXIT

# Buscar un servidor HTTP disponible
if command -v python3 &>/dev/null; then
  echo "✅ Usando Python http.server"
  cd "$ROOT"
  python3 -m http.server "$PORT"
elif command -v python &>/dev/null; then
  echo "✅ Usando Python http.server"
  cd "$ROOT"
  python -m http.server "$PORT"
elif command -v bun &>/dev/null; then
  echo "✅ Usando Bun.serve"
  bun -e "
    const cfg = await Bun.file('$(dirname "$0")/opencode.json').json()
    Bun.serve({
      port: $PORT,
      fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === '/.well-known/opencode') {
          return Response.json(cfg, {
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'public, max-age=3600'
            }
          })
        }
        if (url.pathname === '/health') return Response.json({ status: 'ok' })
        return new Response('gentle-opencode config server', { status: 200 })
      }
    })
    console.log('Bun server running on port $PORT')
  "
elif command -v node &>/dev/null; then
  echo "✅ Usando Node.js http"
  node -e "
    const http = require('http')
    const fs = require('fs')
    const path = require('path')
    const cfg = JSON.parse(fs.readFileSync('$(dirname "$0")/opencode.json','utf8'))
    http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      if (req.url === '/.well-known/opencode') {
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'public, max-age=3600')
        res.end(JSON.stringify(cfg))
      } else if (req.url === '/health') {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({status:'ok'}))
      } else {
        res.end('gentle-opencode config server')
      }
    }).listen($PORT)
    console.log('Node server running on port $PORT')
  "
else
  echo "❌ No se encontró python3, python, bun ni node."
  echo "   Instalá alguno o usá nginx/apache para servir el directorio docs/well-known/"
  exit 1
fi
