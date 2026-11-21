import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOffsets, findVisibleRange } from "../src/core/virtual";

describe("buildOffsets", () => {
  it("高さを累積し、最後に全体の高さを返す", () => {
    assert.deepEqual(buildOffsets([10, 20, 30]), [0, 10, 30, 60]);
  });

  it("空なら [0] だけを返す", () => {
    assert.deepEqual(buildOffsets([]), [0]);
  });
});

describe("findVisibleRange", () => {
  const offsets = buildOffsets([100, 100, 100, 100]);

  it("画面に重なるカードだけを返す", () => {
    assert.deepEqual(findVisibleRange(offsets, 150, 260), { start: 1, end: 3 });
  });

  it("ちょうど境界で接するカードは含めない", () => {
    assert.deepEqual(findVisibleRange(offsets, 100, 200), { start: 1, end: 2 });
  });

  it("先頭より前は先頭に、末尾より後は末尾に寄せる", () => {
    assert.deepEqual(findVisibleRange(offsets, -50, 50), { start: 0, end: 1 });
    assert.deepEqual(findVisibleRange(offsets, 350, 900), { start: 3, end: 4 });
  });

  it("全体を覆えば全件を返す", () => {
    assert.deepEqual(findVisibleRange(offsets, 0, 400), { start: 0, end: 4 });
  });

  it("空の一覧では空の範囲を返す", () => {
    assert.deepEqual(findVisibleRange([0], 0, 100), { start: 0, end: 0 });
  });

  it("高さがばらばらでも正しく範囲を求める", () => {
    const uneven = buildOffsets([50, 200, 30]);
    assert.deepEqual(findVisibleRange(uneven, 60, 240), { start: 1, end: 2 });
    assert.deepEqual(findVisibleRange(uneven, 240, 260), { start: 1, end: 3 });
  });
});
