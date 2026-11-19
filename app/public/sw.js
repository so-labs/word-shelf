// Word Shelf の Service Worker です。アプリのファイルをキャッシュして、
// オフラインでも開けるようにします（データは正本ファイル側にあるため、
// ここで扱うのはアプリ本体だけです）。
// CACHE_NAME は「word-shelf-YYYY.MM-rN」形式で、アプリのバージョンの
// 正本（Single Source of Truth）です。設定画面のバージョン表記は、
// この値から動的に抽出して表示します。ファイル追加やロジック変更など、
// アプリの更新を配るときは、必ずこの文字列を更新してください。
const CACHE_NAME = "word-shelf-2026.11-r2";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
