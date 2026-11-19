// 正本ファイルの読み書き往復と、2形式への出力を検証するCLIです。
// 使い方: npm run roundtrip -- <DictionaryMaster.tsv のパス> [出力先ディレクトリ]
// 出力先を指定すると、書き戻した正本と2形式の出力ファイルも保存します。
// 検証結果は件数と差分の要約だけを表示し、辞書の中身は表示しません。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseMasterTsv, serializeMasterTsv } from "../src/core/master-tsv";
import { serializeGoogleIme } from "../src/core/google-ime";
import { serializeMicrosoftIme, decodeUtf16LeWithBom } from "../src/core/microsoft-ime";
import { isPartOfSpeech } from "../src/core/pos";

const inputPath = process.argv[2];
const outDir = process.argv[3];
if (!inputPath) {
  console.error("使い方: npm run roundtrip -- <DictionaryMaster.tsv のパス> [出力先ディレクトリ]");
  process.exit(2);
}

let failed = false;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "OK " : "NG "} ${label}: ${detail}`);
  if (!ok) failed = true;
}

const originalBytes = readFileSync(inputPath);
const originalText = new TextDecoder("utf-8", { fatal: true }).decode(originalBytes);

// 1. 正本の往復（読み込み → 書き戻しでバイト単位に一致すること）
const entries = parseMasterTsv(originalText);
const reserialized = serializeMasterTsv(entries);
const reserializedBytes = new TextEncoder().encode(reserialized);
let firstDiff = -1;
const maxLen = Math.max(originalBytes.length, reserializedBytes.length);
for (let i = 0; i < maxLen; i++) {
  if (originalBytes[i] !== reserializedBytes[i]) {
    firstDiff = i;
    break;
  }
}
check(
  "正本の往復",
  firstDiff === -1,
  firstDiff === -1
    ? `${entries.length}件、${originalBytes.length}バイト、差分0`
    : `${entries.length}件、最初の差分は${firstDiff}バイト目（元${originalBytes.length}バイト／書き戻し${reserializedBytes.length}バイト）`,
);

// 品詞が45種の範囲内にあること
const unknownPos = entries.filter((entry) => !isPartOfSpeech(entry.pos));
check("品詞の範囲", unknownPos.length === 0, `範囲外の品詞は${unknownPos.length}件`);

// 2. Google日本語入力／Gboard用出力
const googleText = serializeGoogleIme(entries);
const googleLines = googleText === "" ? [] : googleText.replace(/\n$/, "").split("\n");
const googleOk =
  googleLines.length === entries.length &&
  googleLines.every((line, i) => {
    const cells = line.split("\t");
    const entry = entries[i]!;
    return (
      cells.length === 4 &&
      cells[0] === entry.reading &&
      cells[1] === entry.word &&
      cells[2] === entry.pos &&
      cells[3] === entry.comment
    );
  });
check("Google系出力", googleOk, `${googleLines.length}件（全件出力、4列、並び順は正本どおり）`);

// 3. Microsoft IME用出力
const ms = serializeMicrosoftIme(entries);
const msText = decodeUtf16LeWithBom(ms.bytes);
const msLines = msText === "" ? [] : msText.replace(/\r\n$/, "").split("\r\n");
const msCountOk =
  ms.outputCount + ms.excludedCount === entries.length &&
  ms.directCount + ms.mappedCount === ms.outputCount &&
  msLines.length === ms.outputCount;
check(
  "Microsoft IME出力",
  msCountOk,
  `出力${ms.outputCount}件（そのまま・改名 ${ms.directCount}件／寄せ ${ms.mappedCount}件）、除外${ms.excludedCount}件`,
);
for (const [pos, count] of Object.entries(ms.excludedByPos)) {
  console.log(`     除外の内訳: ${pos} ${count}件`);
}

// 出力先が指定されていれば、書き戻した正本と2形式を保存します
if (outDir) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "DictionaryMaster.tsv"), reserializedBytes);
  writeFileSync(join(outDir, "Dictionary_GoogleIME.txt"), googleText, "utf-8");
  writeFileSync(join(outDir, "Dictionary_MicrosoftIME.txt"), ms.bytes);
  console.log(`出力ファイルを ${outDir} に保存しました`);
}

if (failed) {
  console.error("検証に失敗しました");
  process.exit(1);
}
console.log("すべての検証に合格しました");
