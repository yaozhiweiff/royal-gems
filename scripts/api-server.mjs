import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { sqliteDatabase } from '../backend/sqlite.mjs';
await mkdir('.data', { recursive: true });
await build({ entryPoints: ['backend/api.ts'], outfile: '.data/api.mjs', bundle: true, format: 'esm', platform: 'node', target: 'node24' });
const { handleApi } = await import(pathToFileURL(resolve('.data/api.mjs')).href);
const db = sqliteDatabase(process.env.DATABASE_PATH || '.data/royal-gems.sqlite');
db.exec(await readFile('backend/migrations/0001_online.sql', 'utf8'));
const server = createServer(async (req, res) => {
  try {
    let length = 0; const chunks = [];
    for await (const chunk of req) { length += chunk.length; if (length > 4096) { res.writeHead(413); res.end(); return; } chunks.push(chunk); }
    const request = new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const response = await handleApi(request, db, process.env.ALLOWED_ORIGINS || 'http://127.0.0.1:5173,http://127.0.0.1:4173');
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500); res.end('Server error'); }
});
const port = Number(process.env.API_PORT) || 8787;
server.listen(port, '127.0.0.1', () => console.log(`Royal Gems API: http://127.0.0.1:${port}`));
