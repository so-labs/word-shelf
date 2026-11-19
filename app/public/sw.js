// Word Shelf の Service Worker です。アプリのファイルをキャッシュして、
// オフラインでも開けるようにします（データは正本ファイル側にあるため、
// ここで扱うのはアプリ本体だけです）。
// CACHE_NAME は「word-shelf-YYYY.MM-rN」形式で、アプリのバージョンの
// 正本（Single Source of Truth）です。設定画面のバージョン表記は、
// この値から動的に抽出して表示します。ファイル追加やロジック変更など、
// アプリの更新を配るときは、必ずこの文字列を更新してください。
const CACHE_NAME = "word-shelf-2026.11-r5";

// 共有メニュー（Web Share Target）で受け取ったファイルの一時置き場です。
// 名前は src/core/shared-file.ts の SHARE_CACHE_NAME と揃えてください。
// アプリ本体のキャッシュとは別にし、更新時にも消さないで残します。
const SHARE_CACHE_NAME = "word-shelf-share";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME && key !== SHARE_CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// 共有メニューからのPOSTを受け取ります。静的ホスティングにはPOSTを
// 受ける先がないため、ここでファイルを取り出してCacheへ一時置きし、
// アプリのトップへリダイレクトします（アプリ側が取り出して開きます）。
async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (file && typeof file.arrayBuffer === "function") {
      const cache = await caches.open(SHARE_CACHE_NAME);
      const key = new URL("./shared-file", self.registration.scope).href;
      const headers = new Headers();
      headers.set("Content-Type", file.type || "text/plain; charset=utf-8");
      headers.set("X-Shared-File-Name", encodeURIComponent(file.name || "DictionaryMaster.tsv"));
      await cache.put(key, new Response(await file.arrayBuffer(), { headers }));
    }
  } catch {
    // 受け取れなくても、アプリ自体はそのまま開きます
  }
  return Response.redirect(new URL("./?shared=1", self.registration.scope).href, 303);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method === "POST" &&
    url.origin === self.location.origin &&
    url.pathname.endsWith("/share-target")
  ) {
    event.respondWith(handleShareTarget(request));
    return;
  }
  if (request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
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
