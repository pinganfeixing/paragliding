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

// 确保目录存在
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(UPLOAD_DIR));

// 数据库
const db = new Database(path.join(DATA_DIR, 'community.db'));
db.pragma('journal_mode = WAL');

// 建表
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
  createdAt INTEGER NOT NULL,
  FOREIGN KEY (postId) REFERENCES posts(id)
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

// 文件上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2,8) + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 20*1024*1024 } });

// ============ 帖子 API ============

// 帖子列表
app.get('/api/posts', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  const type = req.query.type && req.query.type !== 'all' ? req.query.type : null;
  
  let sql = 'SELECT * FROM posts';
  let countSql = 'SELECT COUNT(*) as total FROM posts';
  const params = [];
  if (type) {
    sql += ' WHERE type = ?';
    countSql += ' WHERE type = ?';
    params.push(type);
  }
  sql += ' ORDER BY createdAt DESC LIMIT ? OFFSET ?';
  
  const posts = db.prepare(sql).all(...params, limit, offset);
  const total = db.prepare(countSql).get(...params).total;
  
  // 每个帖子的评论数
  const commentCount = db.prepare('SELECT postId, COUNT(*) as cnt FROM comments GROUP BY postId');
  const commentMap = {};
  commentCount.all().forEach(c => commentMap[c.postId] = c.cnt);
  
  posts.forEach(p => p.commentCount = commentMap[p.id] || 0);
  
  res.json({ posts, total, page });
});

// 帖子详情
app.get('/api/posts/:id', (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'not found' });
  const comments = db.prepare('SELECT * FROM comments WHERE postId = ? ORDER BY createdAt ASC').all(req.params.id);
  res.json({ post, comments });
});

// 发帖子
app.post('/api/posts', (req, res) => {
  const { type, title, content, author, avatar, base, trackId } = req.body;
  if (!title || !author) return res.status(400).json({ error: 'title and author required' });
  
  const info = db.prepare(`INSERT INTO posts (type, title, content, author, avatar, base, trackId, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(type || 'flight', title, content || '', author, avatar || '', base || '', trackId || '', Date.now());
  
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(info.lastInsertRowid);
  res.json(post);
});

// 点赞
app.post('/api/posts/:id/like', (req, res) => {
  db.prepare('UPDATE posts SET likes = likes + 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// 发评论
app.post('/api/posts/:id/comments', (req, res) => {
  const { author, content } = req.body;
  if (!content || !author) return res.status(400).json({ error: 'author and content required' });
  
  db.prepare('INSERT INTO comments (postId, author, content, createdAt) VALUES (?, ?, ?, ?)')
    .run(req.params.id, author, content, Date.now());
  
  const comments = db.prepare('SELECT * FROM comments WHERE postId = ? ORDER BY createdAt ASC').all(req.params.id);
  res.json({ comments });
});

// ============ 轨迹 API ============

// 轨迹列表
app.get('/api/tracks', (req, res) => {
  const tracks = db.prepare('SELECT * FROM tracks ORDER BY createdAt DESC LIMIT 50').all();
  res.json({ tracks });
});

// 上传轨迹文件
app.post('/api/tracks/upload', upload.single('track'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  const { author, title, base } = req.body;
  const info = db.prepare(`INSERT INTO tracks (filename, originalName, author, title, base, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(req.file.filename, req.file.originalname, author || '', title || req.file.originalname, base || '', Date.now());
  res.json({ id: info.lastInsertRowid, filename: req.file.filename });
});

// 下载轨迹
app.get('/api/tracks/:id/download', (req, res) => {
  const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(req.params.id);
  if (!track) return res.status(404).json({ error: 'not found' });
  db.prepare('UPDATE tracks SET downloads = downloads + 1 WHERE id = ?').run(req.params.id);
  res.download(path.join(UPLOAD_DIR, track.filename), track.originalName);
});

// 上传图片（帖子配图）
app.post('/api/upload/image', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  res.json({ url: '/uploads/' + req.file.filename });
});

// 统计
app.get('/api/stats', (req, res) => {
  const posts = db.prepare('SELECT COUNT(*) as c FROM posts').get().c;
  const tracks = db.prepare('SELECT COUNT(*) as c FROM tracks').get().c;
  const comments = db.prepare('SELECT COUNT(*) as c FROM comments').get().c;
  res.json({ posts, tracks, comments });
});

// 天气（Open-Meteo 免费 API）
app.get('/api/weather', async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m,wind_direction_10m,relative_humidity_2m,weather_code&hourly=temperature_2m,wind_speed_10m,wind_direction_10m&timezone=Asia%2FShanghai&forecast_days=1`;
    const r = await fetch(url);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 基地天气（预设几个常用基地）
app.get('/api/weather/bases', async (req, res) => {
  const bases = [
    { name: '泰山伞场', lat: 36.166, lon: 117.128 },
    { name: '徂徕山', lat: 36.086, lon: 117.200 },
    { name: '莲花山', lat: 35.940, lon: 117.550 },
    { name: '雪野湖', lat: 36.305, lon: 117.502 },
  ];
  try {
    const results = await Promise.all(bases.map(async (b) => {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${b.lat}&longitude=${b.lon}&current=temperature_2m,wind_speed_10m,wind_direction_10m,weather_code&timezone=Asia%2FShanghai`;
      const r = await fetch(url);
      const d = await r.json();
      return { name: b.name, lat: b.lat, lon: b.lon, current: d.current };
    }));
    res.json({ bases: results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Server running on http://127.0.0.1:${PORT}`);
});
