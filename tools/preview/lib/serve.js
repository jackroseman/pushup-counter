// Tiny static file server for the web export (single-page app: unknown paths get index.html).
const http = require('http');
const fs = require('fs');
const path = require('path');

const TYPES = {
  '.js': 'application/javascript', '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.json': 'application/json', '.css': 'text/css', '.ttf': 'font/ttf', '.otf': 'font/otf', '.svg': 'image/svg+xml', '.map': 'application/json',
};

/** Serves `root` on 127.0.0.1 (port 0 = any free port). Resolves { url, close }. */
function serve(root, port = 0) {
  if (!fs.existsSync(path.join(root, 'index.html'))) {
    return Promise.reject(new Error(`No web build in ${root}. Run: npm --prefix tools/preview run build`));
  }
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url || '/').split('?')[0]);
    let file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const { port: actual } = server.address();
      resolve({ url: `http://127.0.0.1:${actual}/`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

module.exports = { serve };
