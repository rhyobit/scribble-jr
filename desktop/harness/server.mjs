// Development harness: serves the ScratchJr pages with the desktop bridge and
// implements the Tauri commands over HTTP, so the app can be exercised in an
// ordinary browser. Not shipped. Usage: node desktop/harness/server.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const pageRoot = path.join(repo, 'desktop/dist'); // run desktop/assemble.mjs first
const bundle = path.join(pageRoot, 'app.bundle.js');
const bridge = path.join(repo, 'desktop/tablet-desktop.js');
const dataDir = path.join(here, 'data');
const filesDir = path.join(dataDir, 'files');
fs.mkdirSync(filesDir, {recursive: true});

const db = new DatabaseSync(path.join(dataDir, 'projects.db'));
db.exec(`CREATE TABLE IF NOT EXISTS PROJECTS (ID INTEGER PRIMARY KEY AUTOINCREMENT, CTIME DATETIME DEFAULT CURRENT_TIMESTAMP, MTIME DATETIME, ALTMD5 TEXT, POS INTEGER, NAME TEXT, JSON TEXT, THUMBNAIL TEXT, OWNER TEXT, GALLERY TEXT, DELETED TEXT, VERSION TEXT);
CREATE TABLE IF NOT EXISTS USERSHAPES (ID INTEGER PRIMARY KEY AUTOINCREMENT, CTIME DATETIME DEFAULT CURRENT_TIMESTAMP, MD5 TEXT, ALTMD5 TEXT, WIDTH TEXT, HEIGHT TEXT, EXT TEXT, NAME TEXT, OWNER TEXT, SCALE TEXT, VERSION TEXT);
CREATE TABLE IF NOT EXISTS USERBKGS (ID INTEGER PRIMARY KEY AUTOINCREMENT, CTIME DATETIME DEFAULT CURRENT_TIMESTAMP, MD5 TEXT, ALTMD5 TEXT, WIDTH TEXT, HEIGHT TEXT, EXT TEXT, OWNER TEXT,  VERSION TEXT);`);
try {
    db.exec('ALTER TABLE PROJECTS ADD COLUMN ISGIFT INTEGER DEFAULT 0');
} catch (e) { /* exists */ }

const validName = (n) => typeof n === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/.test(n) && !n.includes('..');
const bind = (values) => (values || []).map((v) => (v === null || v === undefined ? null : String(v)));

const commands = {
    db_stmt ({json}) {
        try {
            const {stmt, values} = JSON.parse(json);
            const r = db.prepare(stmt).run(...bind(values));
            return String(r.lastInsertRowid);
        } catch (e) {
            return 'SQL error: ' + e.message;
        }
    },
    db_query ({json}) {
        try {
            const {stmt, values} = JSON.parse(json);
            const rows = db.prepare(stmt).all(...bind(values)).map((row) => {
                const o = {};
                for (const [k, v] of Object.entries(row)) {
                    if (v !== null) {
                        o[k] = String(v);
                    }
                }
                return o;
            });
            return JSON.stringify(rows);
        } catch (e) {
            return 'SQL error: ' + e.message;
        }
    },
    file_write ({name, base64}) {
        if (!validName(name)) {
            return '-1';
        }
        fs.writeFileSync(path.join(filesDir, name), Buffer.from(base64.replace(/^data:[^,]*,/, ''), 'base64'));
        return name;
    },
    file_read ({name}) {
        if (!validName(name)) {
            return null;
        }
        const p = path.join(filesDir, name);
        return fs.existsSync(p) ? fs.readFileSync(p).toString('base64') : null;
    },
    file_remove ({name}) {
        try {
            fs.unlinkSync(path.join(filesDir, validName(name) ? name : '__invalid__'));
            return `File: ${name} removed`;
        } catch (e) {
            return `Couldn't remove ${name} file`;
        }
    },
    md5_hex ({s}) {
        return crypto.createHash('md5').update(s, 'utf8').digest('hex');
    },
    clean_assets () {
        return null;
    },
    save_sjr ({fileName, base64}) {
        fs.writeFileSync(path.join(dataDir, fileName), Buffer.from(base64, 'base64'));
        return true;
    },
    open_sjr () {
        const p = path.join(dataDir, 'import.sjr');
        return fs.existsSync(p) ? fs.readFileSync(p).toString('base64') : null;
    },
    data_dir () {
        return dataDir;
    }
};

// Stands in for window.__TAURI_INTERNALS__ in the browser.
const shim = `window.__TAURI_INTERNALS__ = {invoke: function (cmd, args) {
  return fetch('/__invoke/' + cmd, {method: 'POST', body: JSON.stringify(args || {})}).then(function (r) { return r.json(); });
}};`;

const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.json': 'application/json', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.gif': 'image/gif'};

http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/__invoke/')) {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
            const cmd = commands[url.pathname.slice(10)];
            const out = cmd ? cmd(JSON.parse(body || '{}')) : null;
            res.writeHead(cmd ? 200 : 404, {'content-type': 'application/json'});
            res.end(JSON.stringify(out === undefined ? null : out));
        });
        return;
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') {
        rel = '/index.html';
    }
    const file = rel === '/app.bundle.js' ? bundle : path.join(pageRoot, rel);
    if (!file.startsWith(pageRoot) && file !== bundle) {
        res.writeHead(403);
        res.end();
        return;
    }
    fs.readFile(file, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end();
            return;
        }
        const ext = path.extname(file).toLowerCase();
        if (ext === '.html') {
            // Mimic Tauri's initialization_script: bridge runs before page scripts.
            const inject = `<script>${shim}</script><script>${fs.readFileSync(bridge, 'utf8')}</script>`;
            data = Buffer.from(data.toString('utf8').replace(/<head>/i, '<head>' + inject));
        }
        res.writeHead(200, {'content-type': types[ext] || 'application/octet-stream', 'cache-control': 'no-store'});
        res.end(data);
    });
}).listen(Number(process.argv[2]) || 8737, '127.0.0.1', () => console.log('harness on http://127.0.0.1:' + (Number(process.argv[2]) || 8737)));
