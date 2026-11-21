import type { DictionaryEntry } from "./types";

// 登録フォームで、入力した単語と似た登録が既にあることを伝えるための照合
// です。保存を禁止するのではなく、伝えるだけにします。

// 類似とみなす類似度の下限です（1で完全一致）。
export const SIMILARITY_THRESHOLD = 0.8;

// 伝える件数の上限です。
export const SIMILAR_MAX_COUNT = 3;

// 照合用に文字列を正規化します。全角・半角や大文字・小文字、空白の違いを
// 吸収します。
export function normalizeForCompare(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

// 2つの文字列の編集距離（レーベンシュタイン距離）です。
function levenshtein(a: string, b: string): number {
  const aChars = [...a];
  const bChars = [...b];
  let prev: number[] = Array.from({ length: bChars.length + 1 }, (_, j) => j);
  for (let i = 1; i <= aChars.length; i++) {
    const current: number[] = [i];
    for (let j = 1; j <= bChars.length; j++) {
      const cost = aChars[i - 1] === bChars[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    prev = current;
  }
  return prev[bChars.length] ?? 0;
}

// 編集距離から求めた類似度（0〜1）です。長いほうの長さを基準にします。
export function similarityRatio(a: string, b: string): number {
  const maxLength = Math.max([...a].length, [...b].length);
  if (maxLength === 0) return 1;
  return 1 - levenshtein(a, b) / maxLength;
}

// 入力した単語と似た登録を返します。正規化後の完全一致を先に、次に
// 類似度の高い順に並べ、上限件数まで返します。編集中の登録自身は、
// 呼び出し側が excludeIndex で除きます。
export function findSimilarEntries(
  entries: DictionaryEntry[],
  word: string,
  excludeIndex: number | null = null,
): DictionaryEntry[] {
  const target = normalizeForCompare(word);
  if (target === "") return [];
  const scored: { entry: DictionaryEntry; ratio: number }[] = [];
  entries.forEach((entry, index) => {
    if (index === excludeIndex) return;
    const candidate = normalizeForCompare(entry.word);
    if (candidate === "") return;
    const ratio = similarityRatio(target, candidate);
    if (ratio >= SIMILARITY_THRESHOLD) scored.push({ entry, ratio });
  });
  scored.sort((a, b) => b.ratio - a.ratio);
  return scored.slice(0, SIMILAR_MAX_COUNT).map((s) => s.entry);
}
