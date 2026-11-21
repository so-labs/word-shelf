import type { DictionaryEntry } from "./types";

// 登録の内容を表すキーです。未保存の照合と、作業コピーへの控えに使います。
export function entryContentKey(e: DictionaryEntry): string {
  return JSON.stringify([e.primary, e.secondary, e.reading, e.word, e.pos, e.comment]);
}

// 最後に保存（出力）した時点の一覧と現在の登録を比べて、まだ保存されて
// いない登録（追加されたものと、内容が編集されたもの）を返します。
// 同じ内容の登録が複数ある場合に備え、内容ごとの件数を数えて照合します。
export function findUnsavedEntries(
  entries: DictionaryEntry[],
  savedEntries: DictionaryEntry[],
): DictionaryEntry[] {
  const remaining = new Map<string, number>();
  for (const e of savedEntries) {
    const key = entryContentKey(e);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  const unsaved: DictionaryEntry[] = [];
  for (const e of entries) {
    const key = entryContentKey(e);
    const count = remaining.get(key) ?? 0;
    if (count > 0) {
      remaining.set(key, count - 1);
    } else {
      unsaved.push(e);
    }
  }
  return unsaved;
}

// 未保存の登録の内容キーです。作業コピーに控えておき、復元したときに
// 「保存時点の一覧」を再構成するために使います。
export function unsavedContentKeys(
  entries: DictionaryEntry[],
  savedEntries: DictionaryEntry[],
): string[] {
  return findUnsavedEntries(entries, savedEntries).map(entryContentKey);
}

// 復元した一覧から、控えておいた未保存キーに当たる分を取り除いた
// 「保存時点の一覧」を返します。これを保存時点として照合すると、
// 閉じる前に未保存だった登録が、復元後も未保存として表示されます。
export function savedBaselineFromKeys(
  entries: DictionaryEntry[],
  keys: string[],
): DictionaryEntry[] {
  const remaining = new Map<string, number>();
  for (const key of keys) {
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  return entries.filter((e) => {
    const key = entryContentKey(e);
    const count = remaining.get(key) ?? 0;
    if (count > 0) {
      remaining.set(key, count - 1);
      return false;
    }
    return true;
  });
}
