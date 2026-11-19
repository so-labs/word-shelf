// 共有メニュー（Web Share Target）で受け取ったファイルの受け渡しです。
// 静的ホスティングでは共有のPOSTをサーバーで受けられないため、Service
// Worker（public/sw.js）がファイルの中身を専用のCacheへ一時置きし、
// 起動したアプリがここで取り出して開きます。
// Cache名とキーは sw.js 側と揃える必要があるため、変更時は両方直してください。
export const SHARE_CACHE_NAME = "word-shelf-share";
export const SHARE_FILE_NAME_HEADER = "X-Shared-File-Name";

// 共有ファイルの置き場所です。Service Workerのスコープとページの基底URLは
// 同じ場所を指すため、どちらからでも同じURLになります。
export function resolveSharedFileUrl(base: string): string {
  return new URL("./shared-file", base).href;
}

// sw.jsがエンコードして付けたファイル名を取り出します。取れない場合は
// 正本のファイル名に倒します。
export function decodeSharedFileName(value: string | null): string {
  if (!value) return "DictionaryMaster.tsv";
  try {
    const name = decodeURIComponent(value);
    return name || "DictionaryMaster.tsv";
  } catch {
    return "DictionaryMaster.tsv";
  }
}

// 一時置きされた共有ファイルを取り出します。取り出しは1回だけで、
// 読み出した時点でCacheからは消します。共有されていない通常の起動や、
// Cacheが使えない環境では null を返します。
export async function loadSharedFile(): Promise<File | null> {
  try {
    if (!("caches" in window)) return null;
    const cache = await caches.open(SHARE_CACHE_NAME);
    const url = resolveSharedFileUrl(document.baseURI);
    const response = await cache.match(url);
    if (!response) return null;
    await cache.delete(url);
    const blob = await response.blob();
    const name = decodeSharedFileName(response.headers.get(SHARE_FILE_NAME_HEADER));
    return new File([blob], name, { type: blob.type });
  } catch {
    return null;
  }
}
