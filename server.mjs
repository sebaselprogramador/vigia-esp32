import http from 'node:http';
import { readFile } from 'node:fs/promises';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const assets = new Set(['index.html', 'styles.css', 'app.js', 'model.js', 'config.js']);
http.createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).slice(1) || 'index.html';
    if (!assets.has(name)) { res.writeHead(403); res.end('No permitido'); return; }
    const data = await readFile(new URL(name, import.meta.url));
    res.writeHead(200, { 'Content-Type': mime[name.slice(name.lastIndexOf('.'))], 'Cache-Control': 'no-store' }); res.end(data);
  } catch { res.writeHead(404); res.end('No encontrado'); }
}).listen(4173, '127.0.0.1', () => console.log('http://127.0.0.1:4173'));
