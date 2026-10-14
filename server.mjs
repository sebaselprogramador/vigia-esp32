import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('.', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.resolve(root, '.' + relative);
    if (!file.startsWith(root) || !['.html', '.js', '.css'].includes(path.extname(file))) { res.writeHead(403); res.end(); return; }
    const data = await readFile(file); res.writeHead(200, { 'Content-Type': mime[path.extname(file)], 'Cache-Control': 'no-store' }); res.end(data);
  } catch { res.writeHead(404); res.end('No encontrado'); }
}).listen(4173, '127.0.0.1', () => console.log('http://127.0.0.1:4173'));
