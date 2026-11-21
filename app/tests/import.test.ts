import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deflateRawSync } from "node:zlib";
import { IMPORT_PRIMARY, parseDictionaryFile, parseDictionaryText } from "../src/core/import";
import { encodeUtf16LeWithBom } from "../src/core/microsoft-ime";
import { fromMsImePos } from "../src/core/pos";

// テスト用の最小のZIPを作ります（エントリ1件、CRCは読み込み側が使わない
// ため0で埋めます）。
function buildZip(name: string, data: Uint8Array, method: 0 | 8): Uint8Array {
  const compressed = method === 8 ? new Uint8Array(deflateRawSync(data)) : data;
  const nameBytes = new TextEncoder().encode(name);
  const out: number[] = [];
  const u16 = (v: number) => out.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v: number) =>
    out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
  // ローカルヘッダー
  u32(0x04034b50);
  u16(20);
  u16(0);
  u16(method);
  u16(0);
  u16(0);
  u32(0);
  u32(compressed.length);
  u32(data.length);
  u16(nameBytes.length);
  u16(0);
  out.push(...nameBytes, ...compressed);
  // 中央ディレクトリ
  const centralStart = out.length;
  u32(0x02014b50);
  u16(20);
  u16(20);
  u16(0);
  u16(method);
  u16(0);
  u16(0);
  u32(0);
  u32(compressed.length);
  u32(data.length);
  u16(nameBytes.length);
  u16(0);
  u16(0);
  u16(0);
  u16(0);
  u32(0);
  u32(0);
  out.push(...nameBytes);
  // 終端レコード
  u32(0x06054b50);
  u16(0);
  u16(0);
  u16(1);
  u16(1);
  u32(out.length - centralStart);
  u32(centralStart);
  u16(0);
  return new Uint8Array(out);
}

describe("parseDictionaryText: 正本", () => {
  it("正本はそのまま読み、分類も保持する", () => {
    const text =
      "Primary\tSecondary\t読み\t単語\t品詞\tコメント\n" +
      "IT\tAI\tえーあい\tAI\t名詞\t人工知能\n";
    const result = parseDictionaryText(text, "DictionaryMaster.tsv");
    assert.equal(result.formatLabel, "正本ファイル");
    assert.equal(result.note, null);
    assert.deepEqual(result.entries, [
      { primary: "IT", secondary: "AI", reading: "えーあい", word: "AI", pos: "名詞", comment: "人工知能" },
    ]);
  });
});

describe("parseDictionaryText: Google日本語入力", () => {
  it("4列を読み、分類は未分類になる", () => {
    const text = "ちめい\t地名\t地名\t\nよみ\t単語\t名詞\tコメントです\n";
    const result = parseDictionaryText(text, "dictionary.txt");
    assert.equal(result.formatLabel, "Google日本語入力");
    assert.equal(result.entries.length, 2);
    assert.equal(result.entries[0]?.primary, IMPORT_PRIMARY);
    assert.equal(result.entries[0]?.pos, "地名");
    assert.equal(result.entries[1]?.comment, "コメントです");
  });

  it("ファイル名がGoogle系なら、品詞が名詞だけでも判定できる", () => {
    const result = parseDictionaryText("よみ\t単語\t名詞\t\n", "Dictionary_GoogleIME.txt");
    assert.equal(result.formatLabel, "Google日本語入力");
  });
});

describe("parseDictionaryFile: Microsoft IME", () => {
  it("UTF-16LEを読み、品詞を正本の体系へ戻す", async () => {
    const text =
      "ちめい\t地名\t地名その他\r\n" +
      "さへん\t作例\tさ変名詞\tコメント\r\n" +
      "こゆう\t固有名詞\t固有名詞\r\n";
    const bytes = encodeUtf16LeWithBom(text);
    const result = await parseDictionaryFile(bytes, "msime.txt");
    assert.equal(result.formatLabel, "Microsoft IME");
    assert.deepEqual(
      result.entries.map((e) => e.pos),
      ["地名", "名詞サ変", "固有名詞"],
    );
    assert.equal(result.entries[0]?.comment, "");
    assert.equal(result.entries[1]?.comment, "コメント");
    assert.equal(result.entries[0]?.primary, IMPORT_PRIMARY);
  });

  it("3列だけのテキストもMicrosoft IMEと判定する", () => {
    const result = parseDictionaryText("よみ\t単語\t名詞\n", "dictionary.txt");
    assert.equal(result.formatLabel, "Microsoft IME");
  });

  it("「!」のツール情報行を読み飛ばし、決め手の品詞が末尾でも判定する", async () => {
    // 実際のMicrosoft IMEの書き出しの形です: 先頭に「!」の行があり、
    // 行は4列で、決め手になる品詞（慣用句）はごく少数しか現れません。
    const lines = ["!Microsoft IME Dictionary Tool", "!Version: 1"];
    for (let i = 0; i < 60; i++) lines.push(`よみ${i}\t単語${i}\t名詞\t`);
    lines.push("てすと\tテスト\t慣用句\t");
    const bytes = encodeUtf16LeWithBom(lines.join("\r\n") + "\r\n");
    const result = await parseDictionaryFile(bytes, "output1.txt");
    assert.equal(result.formatLabel, "Microsoft IME");
    assert.equal(result.entries.length, 61);
    assert.equal(result.entries[60]?.pos, "独立語");
  });
});

describe("fromMsImePos", () => {
  it("directを優先し、未知の品詞名は undefined を返す", () => {
    assert.equal(fromMsImePos("名詞"), "名詞");
    assert.equal(fromMsImePos("固有名詞"), "固有名詞");
    assert.equal(fromMsImePos("あわ行五段"), "動詞ワ行五段");
    assert.equal(fromMsImePos("姓名接尾語"), "接尾人名");
    assert.equal(fromMsImePos("存在しない品詞"), undefined);
  });
});

describe("parseDictionaryFile: Gboard", () => {
  const gboardText =
    "# Gboard Dictionary version:2\n" +
    "# Gboard Dictionary format:shortcut\tword\tlanguage_tag\tpos_tag\n" +
    "よみ\t単語\tja-JP\t名詞\n" +
    "えいご\tEnglish\ten-US\t名詞\n" +
    "かお\t顔文字\tja-JP\t顔文字\n" +
    "ふるい\t旧形式\tja-JP\n";

  it("ZIP（deflate）を展開し、日本語の行だけを取り込む", async () => {
    const zip = buildZip("dictionary.txt", new TextEncoder().encode(gboardText), 8);
    const result = await parseDictionaryFile(zip, "PersonalDictionary.zip");
    assert.equal(result.formatLabel, "Gboard");
    assert.deepEqual(
      result.entries.map((e) => e.word),
      ["単語", "顔文字", "旧形式"],
    );
    assert.equal(result.entries[0]?.pos, "名詞");
    assert.equal(result.entries[1]?.pos, "顔文字");
    // 品詞の列がない行は名詞になります。
    assert.equal(result.entries[2]?.pos, "名詞");
    assert.equal(result.entries[0]?.comment, "");
  });

  it("ZIP（無圧縮）も展開できる", async () => {
    const zip = buildZip("dictionary.txt", new TextEncoder().encode(gboardText), 0);
    const result = await parseDictionaryFile(zip, "PersonalDictionary.zip");
    assert.equal(result.entries.length, 3);
  });
});

describe("parseDictionaryText: 不明な形式", () => {
  it("対応する形式がなければエラーにする", () => {
    assert.throws(() => parseDictionaryText("ただの文章です\n", "memo.txt"));
  });
});
