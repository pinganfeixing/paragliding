/* js/api.js — 社区后端 API 客户端 */
(function () {
  var BASE = '/api';

  function req(method, path, body) {
    return fetch(BASE + path, {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  var Api = {
    // 帖子
    getPosts: function (page, type) {
      var q = '?page=' + (page || 1);
      if (type && type !== 'all') q += '&type=' + type;
      return req('GET', '/posts' + q);
    },
    getPost: function (id) { return req('GET', '/posts/' + id); },
    createPost: function (data) { return req('POST', '/posts', data); },
    likePost: function (id) { return req('POST', '/posts/' + id + '/like'); },
    addComment: function (id, author, content) {
      return req('POST', '/posts/' + id + '/comments', { author: author, content: content });
    },
    // 轨迹
    getTracks: function () { return req('GET', '/tracks'); },
    uploadTrack: function (file, author, title, base) {
      var fd = new FormData();
      fd.append('track', file);
      fd.append('author', author || '');
      fd.append('title', title || '');
      fd.append('base', base || '');
      return fetch(BASE + '/tracks/upload', { method: 'POST', body: fd })
        .then(function (r) { return r.json(); });
    },
    // 图片
    uploadImage: function (file) {
      var fd = new FormData();
      fd.append('image', file);
      return fetch(BASE + '/upload/image', { method: 'POST', body: fd })
        .then(function (r) { return r.json(); });
    },
    // 统计
    stats: function () { return req('GET', '/stats'); }
  };

  window.SanjiApi = Api;
})();
