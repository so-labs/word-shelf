import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findSimilarEntries,
  normalizeForCompare,
  similarityRatio,
} from "../src/core/similar";
import type { DictionaryEntry } from "../src/core/types";

function entry(word: string, reading = "よみ"): DictionaryEntry {
  return { primary: "分類", secondary: "", reading, word, pos: "名詞", comment: "" };
}

describe("normalizeForCompare", () => {
  it("全角・半角、大文字・小文字、空白の違いを吸収する", () => {
    assert.equal(normalizeForCompare("Ｒｅｇｉｓｔｅｒ"), "register");
    assert.equal(normalizeForCompare(" Word Shelf "), "wordshelf");
    assert.equal(normalizeForCompare(""), "");
  });
});

describe("similarityRatio", () => {
  it("完全一致は1、無関係な語は低くなる", () => {
    assert.equal(similarityRatio("register", "register"), 1);
    assert.ok(similarityRatio("register", "registor") >= 0.8);
    assert.ok(similarityRatio("register", "apple") < 0.8);
  });
});

describe("findSimilarEntries", () => {
  const entries = [
    entry("Register", "れじすたー"),
    entry("レジスター", "れじすたー"),
    entry("register", "register"),
    entry("全然違う単語", "ぜんぜん"),
  ];

  it("完全一致を先に、類似度の高い順に返す", () => {
    const result = findSimilarEntries(entries, "REGISTER");
    assert.deepEqual(
      result.map((e) => e.word),
      ["Register", "register"],
    );
  });

  it("編集中の登録自身は除く", () => {
    const result = findSimilarEntries(entries, "Register", 0);
    assert.deepEqual(
      result.map((e) => e.word),
      ["register"],
    );
  });

  it("空の単語や、似た登録がない場合は空を返す", () => {
    assert.deepEqual(findSimilarEntries(entries, ""), []);
    assert.deepEqual(findSimilarEntries(entries, "バナナ"), []);
  });

  it("上限件数までしか返さない", () => {
    const many = ["abcde", "abcdf", "abcdg", "abcdh", "abcdi"].map((w) => entry(w));
    assert.equal(findSimilarEntries(many, "abcde").length, 3);
  });
});
