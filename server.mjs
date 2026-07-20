import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 4173);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.fbx': 'application/octet-stream',
  '.hdr': 'application/octet-stream', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav'
};

createServer(async (request, response) => {
  try {
    const rawPath = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
    const requested = rawPath === '/' ? '/index.html' : rawPath;
    const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, '');
    let filePath = join(root, safePath);
    if (!filePath.startsWith(root)) throw new Error('Path outside project');
    if ((await stat(filePath)).isDirectory()) filePath = join(filePath, 'index.html');
    const body = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': filePath.includes('/vendor/') || filePath.includes('/assets/') ? 'public, max-age=3600' : 'no-cache',
      'Cross-Origin-Opener-Policy': 'same-origin'
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('CLEARWATER: file not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`\nOPERATION CLEARWATER is ready: http://127.0.0.1:${port}\nPress Ctrl+C to stop.\n`);
});
