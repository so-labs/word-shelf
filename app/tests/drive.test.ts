import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildListQuery,
  detectDriveConflict,
  isDriveBaseline,
  nameEquals,
} from "../src/drive";

describe("Driveの競合確認の控え", () => {
  it("正しい形を受け付け、壊れた値を弾く", () => {
    assert.equal(
      isDriveBaseline({ fileId: "abc", modifiedTime: "2026-11-19T00:00:00.000Z" }),
      true,
    );
    assert.equal(isDriveBaseline(null), false);
    assert.equal(isDriveBaseline({}), false);
    assert.equal(isDriveBaseline({ fileId: 1, modifiedTime: "x" }), false);
    assert.equal(isDriveBaseline({ fileId: "abc" }), false);
  });

  it("競合の判定が開いた時点の控えとDrive側の状態で行われる", () => {
    const base = { fileId: "abc", modifiedTime: "2026-11-19T00:00:00.000Z" };
    // Drive側に正本がなければ競合ではない（新規保存になる）
    assert.equal(detectDriveConflict(null, null), false);
    assert.equal(detectDriveConflict(base, null), false);
    // 控えがなくDrive側にある場合は、上書きになるので競合として扱う
    assert.equal(detectDriveConflict(null, base), true);
    // 開いたときのままなら競合ではない
    assert.equal(detectDriveConflict(base, { ...base }), false);
    // 更新日時が変わっていれば競合
    assert.equal(
      detectDriveConflict(base, { fileId: "abc", modifiedTime: "2026-11-19T01:00:00.000Z" }),
      true,
    );
    // 別のファイルに置き換わっていれば競合
    assert.equal(
      detectDriveConflict(base, { fileId: "xyz", modifiedTime: base.modifiedTime }),
      true,
    );
  });

  it("検索条件の組み立てで引用符をエスケープする", () => {
    assert.equal(nameEquals("Word Shelf"), "name = 'Word Shelf'");
    assert.equal(nameEquals("a'b"), "name = 'a\\'b'");
    assert.equal(
      buildListQuery([nameEquals("Word Shelf"), "trashed = false"]),
      "name = 'Word Shelf' and trashed = false",
    );
  });
});
