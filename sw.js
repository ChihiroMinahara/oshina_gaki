/* お品書き帳 Service Worker v2.4.1
 * - アプリシェル: プリキャッシュ + network-first(3秒タイムアウトでキャッシュへフォールバック)
 * - 画像(pbs.twimg.com): cache-first + 上限500枚(超過分は古い順に削除)
 * - 更新は waiting のまま保持し、ページから SKIP_WAITING メッセージで反映(編集中の強制リロード防止)
 */
'use strict';

const APP_CACHE = 'ohogaki-app-2.4.1';
const IMG_CACHE = 'img-v1';
const IMG_LIMIT = 500;
const NAV_TIMEOUT = 3000;

const SHELL = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './icons/apple-touch-icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    for (const k of keys) {
      if (k !== APP_CACHE && k !== IMG_CACHE) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isImg(url) {
  return url.hostname === 'pbs.twimg.com';
}

async function trimImgCache(cache) {
  try {
    const keys = await cache.keys();
    if (keys.length > IMG_LIMIT) {
      const excess = keys.length - IMG_LIMIT;
      for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
    }
  } catch (err) { /* ignore */ }
}

async function imgHandler(req) {
  const cache = await caches.open(IMG_CACHE);
  const hit = await cache.match(req.url);
  if (hit) {
    // アクセス順を更新(LRU近似)
    cache.put(req.url, hit.clone()).then(() => trimImgCache(cache)).catch(() => {});
    return hit;
  }
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(req.url, res.clone()).then(() => trimImgCache(cache)).catch(() => {});
    }
    return res;
  } catch (err) {
    return new Response('', { status: 504, statusText: 'offline' });
  }
}

async function navHandler(req) {
  const cache = await caches.open(APP_CACHE);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), NAV_TIMEOUT))
    ]);
    if (res && res.ok) {
      cache.put('./index.html', res.clone()).catch(() => {});
      return res;
    }
    throw new Error('bad status');
  } catch (err) {
    const fallback = (await cache.match('./index.html')) || (await cache.match('./'));
    if (fallback) return fallback;
    throw err;
  }
}

async function sameOriginHandler(req) {
  const cache = await caches.open(APP_CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      cache.put(req, res.clone()).catch(() => {});
      return res;
    }
    // エラー応答(5xx等)でもキャッシュがあればキャッシュで継続(オフライン保険)
    const hit = await cache.match(req);
    if (hit) return hit;
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (isImg(url)) { e.respondWith(imgHandler(req)); return; }
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') { e.respondWith(navHandler(req)); return; }
    e.respondWith(sameOriginHandler(req));
  }
});
