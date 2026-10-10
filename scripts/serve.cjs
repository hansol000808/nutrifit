'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.md':'text/plain; charset=utf-8','.jpg':'image/jpeg','.png':'image/png'};
const port = Number(process.env.PORT || 4173);
http.createServer((req,res) => {
  if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  try {
    let requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (requested === '/') {res.writeHead(302,{Location:'/nutrifit/'});res.end();return;}
    if (!requested.startsWith('/nutrifit/')) {res.writeHead(404);res.end('Not found');return;}
    requested = requested.slice('/nutrifit/'.length) || 'index.html';
    const file = path.resolve(root, requested);
    const rel = path.relative(root,file);
    if (rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).some(p=>p.startsWith('.'))) {res.writeHead(403);res.end();return;}
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {res.writeHead(404);res.end('Not found');return;}
    res.writeHead(200,{'Content-Type':types[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-store'});
    if (req.method==='HEAD') res.end(); else fs.createReadStream(file).pipe(res);
  } catch {res.writeHead(400);res.end('Bad request');}
}).listen(port, '127.0.0.1', () => console.log(`NutriFit: http://127.0.0.1:${port}/nutrifit/`));
