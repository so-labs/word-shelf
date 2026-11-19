import type { DictionaryEntry } from "./types";

// Google日本語入力／Gboard用に出力します。
// UTF-8（BOMなし）・LF・ヘッダーなし・読み／単語／品詞／コメントの4列で、
// 全件を正本の並び順のまま出力します。コメントが空でも4列目は常に出力します。
export function serializeGoogleIme(entries: readonly DictionaryEntry[]): string {
  if (entries.length === 0) return "";
  return (
    entries
      .map((entry) => [entry.reading, entry.word, entry.pos, entry.comment].join("\t"))
      .join("\n") + "\n"
  );
}
