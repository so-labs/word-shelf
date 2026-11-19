import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { serializeGoogleIme } from "../src/core/google-ime";
import { decodeUtf16LeWithBom, serializeMicrosoftIme } from "../src/core/microsoft-ime";
import type { DictionaryEntry } from "../src/core/types";

const entries: DictionaryEntry[] = [
  {
    primary: "A",
    secondary: "B",
    reading: "よみ1",
    word: "単語1",
    pos: "名詞",
    comment: "コメント1",
  },
  { primary: "A", secondary: "B", reading: "よみ2", word: "単語2", pos: "組織", comment: "" },
  {
    primary: "A",
    secondary: "B",
    reading: "よみ3",
    word: "単語3",
    pos: "サジェストのみ",
    comment: "",
  },
  {
    primary: "A",
    secondary: "B",
    reading: "よみ4",
    word: "単語4",
    pos: "地名",
    comment: "地名の注記",
  },
];

describe("Google日本語入力／Gboard用出力", () => {
  it("全件を4列で出力し、コメントが空でも4列目を出す", () => {
    assert.equal(
      serializeGoogleIme(entries),
      "よみ1\t単語1\t名詞\tコメント1\n" +
        "よみ2\t単語2\t組織\t\n" +
        "よみ3\t単語3\tサジェストのみ\t\n" +
        "よみ4\t単語4\t地名\t地名の注記\n",
    );
  });
});

describe("Microsoft IME用出力", () => {
  it("BOM付きUTF-16LE・CRLFで、除外と変換が効く", () => {
    const result = serializeMicrosoftIme(entries);
    assert.equal(result.bytes[0], 0xff);
    assert.equal(result.bytes[1], 0xfe);
    assert.equal(result.outputCount, 3);
    assert.equal(result.directCount, 2);
    assert.equal(result.mappedCount, 1);
    assert.equal(result.excludedCount, 1);
    assert.deepEqual(result.excludedByPos, { サジェストのみ: 1 });
    // コメントがある行だけ4列目を付け、品詞はファイル上の名前に変換する
    assert.equal(
      decodeUtf16LeWithBom(result.bytes),
      "よみ1\t単語1\t名詞\tコメント1\r\n" +
        "よみ2\t単語2\t固有名詞\r\n" +
        "よみ4\t単語4\t地名その他\t地名の注記\r\n",
    );
  });

  it("45種にない品詞はエラーで止める", () => {
    const bad: DictionaryEntry[] = [
      { primary: "", secondary: "", reading: "x", word: "y", pos: "不明な品詞", comment: "" },
    ];
    assert.throws(() => serializeMicrosoftIme(bad), /品詞にない/);
  });
});
