#!/bin/bash
# 一键部署社区后端
set -e

echo "=== 1. 安装 Node.js ==="
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
fi
node -v

echo "=== 2. 创建目录 ==="
mkdir -p /var/www/pinganfeixing-server/{data,uploads}
cd /var/www/pinganfeixing-server

echo "=== 3. 写 package.json ==="
cat > package.json << 'PKGEOF'
{
  "name": "pinganfeixing-server",
  "version": "1.0.0",
  "dependencies": {
    "express": "^4.19.2",
    "better-sqlite3": "^11.3.0",
    "multer": "^1.4.5-lts.1",
    "cors": "^2.8.5"
  }
}
PKGEOF

echo "=== 4. 写 server.js ==="
cat > server.js << 'SERVEREOF'
const express = require('express');
const Database = require('better-sqlite3');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;
const DATA_DIR = '/var/www/pinganfeixing-server/data';
const UPLOAD_DIR = '/var/www/pinganfeixing-server/uploads';

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(UPLOAD_DIR));

const db = new Database(path.join(DATA_DIR, 'community.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT DEFAULT 'flight',
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  author TEXT NOT NULL,
  avatar TEXT DEFAULT '',
  base TEXT DEFAULT '',
  trackId TEXT DEFAULT '',
  createdAt INTEGER NOT NULL,
  likes INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  postId INTEGER NOT NULL,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  createdAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  originalName TEXT,
  author TEXT,
  title TEXT,
  base TEXT,
  distance REAL DEFAULT 0,
  maxAlt REAL DEFAULT 0,
  durationSec INTEGER DEFAULT 0,
  thermalCount INTEGER DEFAULT 0,
  createdAt INTEGER NOT NULL,
  downloads INTEGER DEFAULT 0
);
`);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2,8) + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 20*1024*1024 } });

app.get('/api/posts', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  const type = req.query.type && req.query.type !== 'all' ? req.query.type : null;
  let sql = 'SELECT * FROM posts', countSql = 'SELECT COUNT(*) as total FROM posts';
  const params = [];
  if (type) { sql += ' WHERE type = ?'; countSql += ' WHERE type = ?'; params.push(type); }
  sql += ' ORDER BY createdAt DESC LIMIT ? OFFSET ?';
  const posts = db.prepare(sql).all(...params, limit, offset);
  const total = db.prepare(countSql).get(...params).total;
  const cm = {};
  db.prepare('SELECT postId, COUNT(*) as cnt FROM comments GROUP BY postId').all().forEach(c => cm[c.postId] = c.cnt);
  posts.forEach(p => p.commentCount = cm[p.id] || 0);
  res.json({ posts, total, page });
});

app.get('/api/posts/:id', (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'not found' });
  const comments = db.prepare('SELECT * FROM comments WHERE postId = ? ORDER BY createdAt ASC').all(req.params.id);
  res.json({ post, comments });
});

app.post('/api/posts', (req, res) => {
  const { type, title, content, author, avatar, base, trackId } = req.body;
  if (!title || !author) return res.status(400).json({ error: 'title and author required' });
  const info = db.prepare(`INSERT INTO posts (type, title, content, author, avatar, base, trackId, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(type || 'flight', title, content || '', author, avatar || '', base || '', trackId || '', Date.now());
  res.json(db.prepare('SELECT * FROM posts WHERE id = ?').get(info.lastInsertRowid));
});

app.post('/api/posts/:id/like', (req, res) => {
  db.prepare('UPDATE posts SET likes = likes + 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/posts/:id/comments', (req, res) => {
  const { author, content } = req.body;
  if (!content || !author) return res.status(400).json({ error: 'author and content required' });
  db.prepare('INSERT INTO comments (postId, author, content, createdAt) VALUES (?, ?, ?, ?)').run(req.params.id, author, content, Date.now());
  res.json({ comments: db.prepare('SELECT * FROM comments WHERE postId = ? ORDER BY createdAt ASC').all(req.params.id) });
});

app.get('/api/tracks', (req, res) => {
  res.json({ tracks: db.prepare('SELECT * FROM tracks ORDER BY createdAt DESC LIMIT 50').all() });
});

app.post('/api/tracks/upload', upload.single('track'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  const { author, title, base } = req.body;
  const info = db.prepare(`INSERT INTO tracks (filename, originalName, author, title, base, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)`).run(req.file.filename, req.file.originalname, author || '', title || req.file.originalname, base || '', Date.now());
  res.json({ id: info.lastInsertRowid, filename: req.file.filename });
});

app.get('/api/tracks/:id/download', (req, res) => {
  const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(req.params.id);
  if (!track) return res.status(404).json({ error: 'not found' });
  db.prepare('UPDATE tracks SET downloads = downloads + 1 WHERE id = ?').run(req.params.id);
  res.download(path.join(UPLOAD_DIR, track.filename), track.originalName);
});

app.post('/api/upload/image', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  res.json({ url: '/uploads/' + req.file.filename });
});

app.get('/api/stats', (req, res) => {
  res.json({
    posts: db.prepare('SELECT COUNT(*) as c FROM posts').get().c,
    tracks: db.prepare('SELECT COUNT(*) as c FROM tracks').get().c,
    comments: db.prepare('SELECT COUNT(*) as c FROM comments').get().c
  });
});

app.listen(PORT, '127.0.0.1', () => console.log(`Server running on :${PORT}`));
SERVEREOF

echo "=== 5. 安装依赖 ==="
npm install --production

echo "=== 6. 配置 systemd 开机自启 ==="
cat > /etc/systemd/system/pinganfeixing.service << 'SVCEOF'
[Unit]
Description=PinganFeixing Community Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/var/www/pinganfeixing-server
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable pinganfeixing
systemctl restart pinganfeixing
sleep 2
systemctl status pinganfeixing --no-pager | head -5

echo "=== 7. 配置 Nginx 反代 ==="
cat > /etc/nginx/sites-available/pinganfeixing << 'NGXEOF'
server {
    listen 80;
    server_name pinganfeixing.site www.pinganfeixing.site 62.234.144.193;
    root /var/www/pinganfeixing;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 20M;
    }
    location /uploads/ {
        proxy_pass http://127.0.0.1:3000;
    }
    location / { try_files $uri $uri/ /index.html; }
}
NGXEOF

nginx -t && systemctl reload nginx

echo "=== 8. 测试 API ==="
sleep 1
curl -s http://127.0.0.1:3000/api/stats

echo ""
echo "=== ✅ 部署完成！==="
echo "网站：https://pinganfeixing.site"
echo "API：https://pinganfeixing.site/api/posts"
