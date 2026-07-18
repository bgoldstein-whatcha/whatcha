'use strict';
var http = require('http');
var fs = require('fs');
var path = require('path');

var root = __dirname;
var port = process.argv[2] || 8743;

var types = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.txt': 'text/plain', '.xml': 'application/xml'
};

http.createServer(function (req, res) {
  var urlPath = decodeURIComponent(req.url.split('?')[0]);

  // dev-only helper: POST { path, dataUrl } to write a cropped/exported
  // image straight to disk from the browser, bypassing the tool-response
  // size limits of round-tripping big base64 strings through chat.
  if (req.method === 'POST' && urlPath === '/_save') {
    var body = '';
    req.on('data', function (chunk) { body += chunk; });
    req.on('end', function () {
      try {
        var payload = JSON.parse(body);
        var savePath = path.join(root, payload.path);
        if (savePath.indexOf(root) !== 0) { res.writeHead(403); res.end(); return; }
        var base64 = payload.dataUrl.replace(/^data:image\/\w+;base64,/, '');
        fs.writeFileSync(savePath, new Buffer(base64, 'base64'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: payload.path }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  if (urlPath === '/') urlPath = '/index.html';
  var filePath = path.join(root, urlPath);
  if (filePath.indexOf(root) !== 0) { res.writeHead(403); res.end(); return; }

  fs.readFile(filePath, function (err, data) {
    if (err) {
      // clean-URL fallback (e.g. /whatchalookinat -> /whatchalookinat/index.html),
      // matching how most static hosts (Netlify, Vercel, Cloudflare Pages) resolve
      // a directory-style URL with no extension
      if (path.extname(filePath) === '') {
        var indexPath = path.join(filePath, 'index.html');
        fs.readFile(indexPath, function (err2, data2) {
          if (err2) { res.writeHead(404); res.end('Not found'); return; }
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(data2);
        });
        return;
      }
      res.writeHead(404); res.end('Not found'); return;
    }
    var ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(port, function () { console.log('serving on ' + port); });
