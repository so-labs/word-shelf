import type { DictionaryEntry } from "./types";

// 正本ファイル（DictionaryMaster.tsv）の形式です。
// UTF-8（BOMなし）・LF・ヘッダー行あり・6列・タブ区切りを厳密に維持します。
export const MASTER_HEADER = ["Primary", "Secondary", "読み", "単語", "品詞", "コメント"] as const;

const COLUMN_COUNT = MASTER_HEADER.length;

// 数式保護: 先頭が「=」のセルは、書き出し時に先頭へ「'」を付け、
// 読み込み時に取り除きます。
function protectCell(cell: string): string {
  return cell.startsWith("=") ? `'${cell}` : cell;
}

function unprotectCell(cell: string): string {
  return cell.startsWith("'=") ? cell.slice(1) : cell;
}

function assertCellIsWritable(cell: string, rowIndex: number): void {
  if (cell.includes("\t") || cell.includes("\n") || cell.includes("\r")) {
    throw new Error(
      `正本に書き出せない文字（タブまたは改行）が含まれています: ${rowIndex + 1}件目`,
    );
  }
}

// 正本ファイルのテキストを読み込みます。
// ヘッダーが想定と異なる場合は、空読みせずエラーで止めます。
// 改行はLFが正規形ですが、読み込みではCRLFも受け付けます。
// 空行は読み飛ばし、列が足りない行は空文字で補い、7列目以降は無視します。
export function parseMasterTsv(text: string): DictionaryEntry[] {
  if (text.startsWith("\uFEFF")) {
    throw new Error("正本ファイルにBOMが付いています（正本はBOMなしが仕様です）");
  }
  const lines = text.split(/\r\n|\n/);
  const header = lines[0] ?? "";
  if (header !== MASTER_HEADER.join("\t")) {
    throw new Error(`正本ファイルのヘッダーが想定と異なります: ${JSON.stringify(header)}`);
  }
  const entries: DictionaryEntry[] = [];
  for (const line of lines.slice(1)) {
    if (line.trim() === "") continue;
    const cells = line.split("\t");
    const [primary = "", secondary = "", reading = "", word = "", pos = "", comment = ""] =
      Array.from({ length: COLUMN_COUNT }, (_, i) => unprotectCell(cells[i] ?? ""));
    entries.push({ primary, secondary, reading, word, pos, comment });
  }
  return entries;
}

// 正本ファイルのテキストへ書き出します。
// すべての行をLFで終端します（最終行にも改行を付けます）。
export function serializeMasterTsv(entries: readonly DictionaryEntry[]): string {
  const lines: string[] = [MASTER_HEADER.join("\t")];
  entries.forEach((entry, index) => {
    const cells = [
      entry.primary,
      entry.secondary,
      entry.reading,
      entry.word,
      entry.pos,
      entry.comment,
    ];
    cells.forEach((cell) => assertCellIsWritable(cell, index));
    lines.push(cells.map(protectCell).join("\t"));
  });
  return lines.join("\n") + "\n";
}
