#!/usr/bin/env node
// _scrape-receiver.mjs — tiny local HTTP server that receives scrape JSON
// from the browser and writes it to scrapes/<city>/<name>.json.
//
// Usage: node tools/_scrape-receiver.mjs <city> [port=8787]
// Then in browser: fetch('http://localhost:8787/<name>', { method: 'POST', body: JSON.stringify(data) })
import { createServer } from 'http';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const city = process.argv[2];
const port = Number(process.argv[3]) || 8787;
if (!city) { console.error('Usage: _scrape-receiver.mjs <city> [port]'); process.exit(1); }

const outDir = resolve(REPO_ROOT, 'scrapes', city);
mkdirSync(outDir, { recursive: true });

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST') { res.writeHead(404); res.end(); return; }

  const safeName = (req.url.slice(1).replace(/[^\w.-]/g, '_') || 'scrape') + (req.url.endsWith('.json') ? '' : '.json');
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf-8');
    const path = resolve(outDir, safeName);
    writeFileSync(path, body);
    console.log(`✓ wrote ${path} (${body.length} chars)`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ path: safeName, size: body.length }));
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Receiver listening on http://localhost:${port}/<name>.json → scrapes/${city}/`);
  console.log(`Browser usage:`);
  console.log(`  fetch('http://localhost:${port}/<name>.json', { method: 'POST', body: JSON.stringify(data) })`);
});
