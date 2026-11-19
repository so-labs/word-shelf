import { toMsImeConversion } from "./pos";
import type { DictionaryEntry } from "./types";

export interface MicrosoftImeResult {
  // UTF-16LE（BOM付き）のバイト列です。
  bytes: Uint8Array<ArrayBuffer>;
  // 出力した件数です。
  outputCount: number;
  // そのまま、または名前が変わるだけで対応した件数です。
  directCount: number;
  // 意味の近い別の品詞へ寄せて対応した件数です。
  mappedCount: number;
  // 対応する品詞がなく、出力に含めなかった件数です。
  excludedCount: number;
  // 除外した件数の品詞ごとの内訳です。
  excludedByPos: Record<string, number>;
}

// Microsoft IME用に出力します。
// UTF-16LE（BOM付き）・CRLF・ヘッダー行なし。列は読み／単語／品詞で、
// コメントがある行のみ4列目にコメントを付けます。
// 対応する品詞がないエントリは出力に含めず、件数を数えて返します。
export function serializeMicrosoftIme(entries: readonly DictionaryEntry[]): MicrosoftImeResult {
  const lines: string[] = [];
  let directCount = 0;
  let mappedCount = 0;
  let excludedCount = 0;
  const excludedByPos: Record<string, number> = {};

  entries.forEach((entry, index) => {
    const conversion = toMsImeConversion(entry.pos);
    if (conversion === undefined) {
      throw new Error(
        `正本の品詞にない値が使われています: ${JSON.stringify(entry.pos)}（${index + 1}件目）`,
      );
    }
    if (conversion.kind === "excluded") {
      excludedCount += 1;
      excludedByPos[entry.pos] = (excludedByPos[entry.pos] ?? 0) + 1;
      return;
    }
    if (conversion.kind === "direct") directCount += 1;
    else mappedCount += 1;
    const cells = [entry.reading, entry.word, conversion.msPos];
    if (entry.comment !== "") cells.push(entry.comment);
    lines.push(cells.join("\t"));
  });

  const text = lines.length === 0 ? "" : lines.join("\r\n") + "\r\n";
  return {
    bytes: encodeUtf16LeWithBom(text),
    outputCount: lines.length,
    directCount,
    mappedCount,
    excludedCount,
    excludedByPos,
  };
}

// UTF-16LEでエンコードし、先頭にBOM（FF FE）を付けます。
export function encodeUtf16LeWithBom(text: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes[0] = 0xff;
  bytes[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    bytes[2 + i * 2] = code & 0xff;
    bytes[2 + i * 2 + 1] = code >> 8;
  }
  return bytes;
}

// serializeMicrosoftImeが返したバイト列をテキストへ戻します（検証用）。
export function decodeUtf16LeWithBom(bytes: Uint8Array): string {
  if (bytes[0] !== 0xff || bytes[1] !== 0xfe) {
    throw new Error("UTF-16LEのBOMが付いていません");
  }
  let text = "";
  for (let i = 2; i + 1 < bytes.length; i += 2) {
    text += String.fromCharCode(bytes[i]! | (bytes[i + 1]! << 8));
  }
  return text;
}
