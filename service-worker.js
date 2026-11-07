/* service-worker.js — 滑翔伞平安飞行 H5 离线 PWA
 *
 * 策略：预缓存应用外壳（index.html / css / js / manifest），
 * 运行时先网络、失败回退缓存（CDN 的 Cesium/ECharts 与卫星瓦片仍需联网）。
 * 版本号变更即清理旧缓存，避免更新后加载到过期外壳。
 */
var CACHE_NAME = 'sanji-h5-v43';
var APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app-core.js',
  './js/storage.js',
  './js/main.js'
];
// 只有外壳文件走"强制绕过 HTTP 缓存"的拦截；
// vendor/（自托管 Cesium、ECharts，几十 MB）必须走浏览器正常缓存，
// 否则每次启动都要重新下载，还会把几十 MB 塞进 Cache Storage。
var SHELL_PATHS = ['/', '/index.html', '/manifest.json', '/css/style.css',
  '/js/app-core.js', '/js/storage.js', '/js/main.js'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_SHELL);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  // 只拦截同源 GET（CDN 资源交给浏览器默认行为，避免跨域缓存污染）
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  // 非外壳文件（vendor 库、图片、接口）直接放行，交给浏览器 HTTP 缓存
  var path = '';
  try { path = new URL(e.request.url).pathname; } catch (err) { path = ''; }
  if (SHELL_PATHS.indexOf(path) < 0) return;
  e.respondWith(
    // cache:'no-store' 强制绕过浏览器 HTTP 缓存，否则手机可能一直拿到旧外壳
    fetch(e.request, { cache: 'no-store' })
      .then(function (resp) {
        // 网络成功 → 更新缓存副本（保持离线可用为最新外壳）
        if (resp && resp.ok) {
          var clone = resp.clone();
          caches.open(CACHE_NAME).then(function (c) { c.put(e.request, clone); });
        }
        return resp;
      })
      .catch(function () {
        // 离线 → 回退缓存
        return caches.match(e.request, { ignoreSearch: true })
          .then(function (hit) { return hit || caches.match('./index.html'); });
      })
  );
});
