import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MS_IME_CONVERSION, PARTS_OF_SPEECH, toMsImeConversion } from "../src/core/pos";

describe("品詞とMicrosoft IME変換表", () => {
  it("正本の品詞は45種で重複がない", () => {
    assert.equal(PARTS_OF_SPEECH.length, 45);
    assert.equal(new Set(PARTS_OF_SPEECH).size, 45);
  });

  it("45種すべてに変換が定義されている", () => {
    for (const pos of PARTS_OF_SPEECH) {
      assert.notEqual(MS_IME_CONVERSION[pos], undefined);
      assert.notEqual(toMsImeConversion(pos), undefined);
    }
  });

  it("内訳はそのまま・改名30種、寄せ7種、除外8種", () => {
    const kinds = PARTS_OF_SPEECH.map((pos) => MS_IME_CONVERSION[pos].kind);
    assert.equal(kinds.filter((k) => k === "direct").length, 30);
    assert.equal(kinds.filter((k) => k === "mapped").length, 7);
    assert.equal(kinds.filter((k) => k === "excluded").length, 8);
  });

  it("除外は対応がない8種だけ", () => {
    const excluded = PARTS_OF_SPEECH.filter((pos) => MS_IME_CONVERSION[pos].kind === "excluded");
    assert.deepEqual(excluded, [
      "サジェストのみ",
      "動詞ハ行四段",
      "動詞カ変",
      "動詞サ変",
      "動詞ザ変",
      "動詞ラ変",
      "終助詞",
      "抑制単語",
    ]);
  });

  it("ファイル上の品詞名への改名が入っている", () => {
    assert.deepEqual(toMsImeConversion("地名"), { kind: "direct", msPos: "地名その他" });
    assert.deepEqual(toMsImeConversion("接尾人名"), { kind: "direct", msPos: "姓名接尾語" });
    assert.deepEqual(toMsImeConversion("接尾地名"), { kind: "direct", msPos: "地名接尾語" });
    assert.deepEqual(toMsImeConversion("動詞ワ行五段"), { kind: "direct", msPos: "あわ行五段" });
    assert.deepEqual(toMsImeConversion("動詞一段"), { kind: "direct", msPos: "一段動詞" });
    assert.deepEqual(toMsImeConversion("名詞サ変"), { kind: "direct", msPos: "さ変名詞" });
    assert.deepEqual(toMsImeConversion("名詞形動"), { kind: "direct", msPos: "形動名詞" });
  });

  it("寄せの変換先が正しい", () => {
    assert.deepEqual(toMsImeConversion("組織"), { kind: "mapped", msPos: "固有名詞" });
    assert.deepEqual(toMsImeConversion("独立語"), { kind: "mapped", msPos: "慣用句" });
    assert.deepEqual(toMsImeConversion("品詞なし"), { kind: "mapped", msPos: "名詞" });
  });

  it("45種にない品詞は undefined", () => {
    assert.equal(toMsImeConversion("存在しない品詞"), undefined);
  });
});
