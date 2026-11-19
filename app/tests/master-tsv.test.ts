import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MASTER_HEADER, parseMasterTsv, serializeMasterTsv } from "../src/core/master-tsv";
import type { DictionaryEntry } from "../src/core/types";

const header = MASTER_HEADER.join("\t");

describe("正本TSVの読み書き", () => {
  it("読み込み→書き戻しでバイト単位に一致する", () => {
    const text =
      `${header}\n` +
      "分類A\t分類B\tよみ\t単語\t名詞\tコメント\n" +
      "分類A\t\tよみ2\t=数式ではない単語\tサジェストのみ\t\n";
    // 先頭が「=」のセルは「'」付きで保存されている形を入力にする
    const stored = text.replace("\t=数式ではない単語", "\t'=数式ではない単語");
    const entries = parseMasterTsv(stored);
    assert.equal(entries.length, 2);
    assert.equal(entries[1]!.word, "=数式ではない単語");
    assert.equal(serializeMasterTsv(entries), stored);
  });

  it("数式保護は、先頭が「=」のセルにだけ効く", () => {
    const entry: DictionaryEntry = {
      primary: "=A",
      secondary: "B=",
      reading: "よみ",
      word: "=",
      pos: "名詞",
      comment: "",
    };
    const line = serializeMasterTsv([entry]).split("\n")[1]!;
    assert.equal(line.split("\t")[0], "'=A");
    assert.equal(line.split("\t")[1], "B=");
    assert.equal(line.split("\t")[3], "'=");
  });

  it("BOM付きはエラーで止める", () => {
    assert.throws(() => parseMasterTsv(`\uFEFF${header}\n`), /BOM/);
  });

  it("ヘッダーが異なる場合はエラーで止める", () => {
    assert.throws(() => parseMasterTsv("a\tb\tc\td\te\tf\n"), /ヘッダー/);
  });

  it("CRLFと空行を受け付け、列不足は空文字で補う", () => {
    const text = `${header}\r\n分類A\t分類B\tよみ\t単語\t名詞\r\n\r\n`;
    const entries = parseMasterTsv(text);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.comment, "");
  });

  it("セル内のタブや改行は書き出し時にエラーにする", () => {
    const entry: DictionaryEntry = {
      primary: "a\tb",
      secondary: "",
      reading: "",
      word: "",
      pos: "名詞",
      comment: "",
    };
    assert.throws(() => serializeMasterTsv([entry]), /タブまたは改行/);
  });
});
