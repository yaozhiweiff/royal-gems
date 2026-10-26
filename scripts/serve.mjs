import { createServer, request as proxyRequest } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const root = fileURLToPath(new URL('../dist/', import.meta.url)).replace(/[\\/]+$/, '');
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png', '.webp':'image/webp', '.woff2':'font/woff2', '.ttf':'font/ttf', '.txt':'text/plain; charset=utf-8' };
try { await stat(resolve(root,'index.html')); } catch { console.error('Please run npm run build first.'); process.exit(1); }
const server = createServer(async (request,response) => {
  if (request.url.startsWith('/api/')) {
    const proxy = proxyRequest(`http://127.0.0.1:${process.env.API_PORT || 8787}${request.url}`, { method: request.method, headers: request.headers }, result => { response.writeHead(result.statusCode, result.headers); result.pipe(response); });
    proxy.on('error', () => { response.writeHead(503, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ code: 'API_OFFLINE', message: '游戏服务尚未启动，请运行 npm run dev:api' })); });
    request.pipe(proxy); return;
  }
  if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!path.startsWith(root+sep)) { response.writeHead(403); response.end(); return; }
    const contents = await readFile(path);
    response.writeHead(200,{'Content-Type':types[extname(path)] ?? 'application/octet-stream','Cache-Control':'no-cache'});
    response.end(request.method === 'HEAD' ? undefined : contents);
  } catch { response.writeHead(404); response.end('Not found'); }
});
let port = Number(process.env.PORT) || 4173;
server.on('error', error => { if(error.code === 'EADDRINUSE' && port < 4190) server.listen(++port,'127.0.0.1'); else {console.error(error);process.exit(1);} });
server.on('listening', () => {
  const url = `http://127.0.0.1:${port}`;
  console.log(`Royal Gems is ready: ${url}\nKeep this window open while playing. Press Ctrl+C to stop.`);
  if(process.argv.includes('--open') && process.platform === 'win32') spawn('cmd.exe',['/c','start','',url],{windowsHide:true,stdio:'ignore'}).unref();
});
if (process.argv.includes('--with-api')) {
  let alive = false; try { alive = (await fetch('http://127.0.0.1:8787/api/health')).ok; } catch { /* start the bundled local backend */ }
  if (!alive) {
    const child = spawn(process.execPath, ['scripts/api-server.mjs'], { cwd: fileURLToPath(new URL('../', import.meta.url)), windowsHide: true, stdio: 'inherit' });
    process.on('exit', () => child.kill());
    for (let attempt = 0; attempt < 40; attempt++) { try { if ((await fetch('http://127.0.0.1:8787/api/health')).ok) break; } catch { /* waiting */ } await new Promise(resolve => setTimeout(resolve, 250)); }
  }
}
server.listen(port,'127.0.0.1');
