import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isWorkCopy } from "../src/core/work-copy";

describe("作業コピーの形チェック", () => {
  it("正しい形を受け付ける", () => {
    assert.equal(
      isWorkCopy({
        entries: [
          { primary: "A", secondary: "B", reading: "よみ", word: "単語", pos: "名詞", comment: "" },
        ],
        fileName: "DictionaryMaster.tsv",
        savedAt: "2026-11-19T00:00:00.000Z",
      }),
      true,
    );
    assert.equal(isWorkCopy({ entries: [], fileName: null, savedAt: "x" }), true);
  });

  it("壊れた値は退避として扱わない", () => {
    assert.equal(isWorkCopy(null), false);
    assert.equal(isWorkCopy({}), false);
    assert.equal(isWorkCopy({ entries: "x", fileName: null, savedAt: "x" }), false);
    assert.equal(isWorkCopy({ entries: [{ reading: 1 }], fileName: null, savedAt: "x" }), false);
  });
});
