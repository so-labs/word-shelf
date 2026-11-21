import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findUnsavedEntries,
  savedBaselineFromKeys,
  unsavedContentKeys,
} from "../src/core/unsaved";
import type { DictionaryEntry } from "../src/core/types";

const entry = (partial: Partial<DictionaryEntry>): DictionaryEntry => ({
  primary: "仕事",
  secondary: "ソフトウェア",
  reading: "よみ",
  word: "単語",
  pos: "名詞",
  comment: "",
  ...partial,
});

describe("未保存の登録の検出", () => {
  it("保存時点と同じ一覧なら未保存はない", () => {
    const saved = [entry({ word: "a" }), entry({ word: "b" })];
    assert.deepEqual(findUnsavedEntries([...saved], saved), []);
  });

  it("追加した登録を未保存として返す", () => {
    const saved = [entry({ word: "a" })];
    const added = entry({ word: "b" });
    assert.deepEqual(findUnsavedEntries([...saved, added], saved), [added]);
  });

  it("内容を編集した登録を未保存として返す", () => {
    const saved = [entry({ word: "a", comment: "前" })];
    const edited = entry({ word: "a", comment: "後" });
    assert.deepEqual(findUnsavedEntries([edited], saved), [edited]);
  });

  it("内容が変わらない編集は未保存にしない", () => {
    const saved = [entry({ word: "a", comment: "同じ" })];
    const same = entry({ word: "a", comment: "同じ" });
    assert.deepEqual(findUnsavedEntries([same], saved), []);
  });

  it("同じ内容の登録が複数ある場合は件数で照合する", () => {
    const one = entry({ word: "a" });
    const saved = [one];
    const extra = entry({ word: "a" });
    // 保存済みが1件で同内容が2件あれば、余った1件だけが未保存です。
    assert.deepEqual(findUnsavedEntries([one, extra], saved), [extra]);
    // 保存済みが2件あれば、どちらも未保存ではありません。
    assert.deepEqual(findUnsavedEntries([one, extra], [one, extra]), []);
  });

  it("削除した登録は未保存に含まれない", () => {
    const first = entry({ word: "a" });
    const saved = [first, entry({ word: "b" })];
    assert.deepEqual(findUnsavedEntries([first], saved), []);
  });

  it("未保存キーを控えて復元すると、未保存の顔ぶれが再現される", () => {
    const first = entry({ word: "a" });
    const saved = [first, entry({ word: "b", comment: "前" })];
    const edited = entry({ word: "b", comment: "後" });
    const added = entry({ word: "c" });
    const current = [first, edited, added];
    const keys = unsavedContentKeys(current, saved);
    // 復元した一覧（同じ内容の新しいオブジェクト）から保存時点を再構成し、
    // 照合すると、閉じる前と同じ2件が未保存になります。
    const restored = current.map((e) => ({ ...e }));
    const baseline = savedBaselineFromKeys(restored, keys);
    const unsaved = findUnsavedEntries(restored, baseline);
    assert.deepEqual(
      unsaved.map((e) => e.word),
      ["b", "c"],
    );
  });

  it("キーがなければ、復元した一覧がそのまま保存時点になる", () => {
    const restored = [entry({ word: "a" }), entry({ word: "b" })];
    const baseline = savedBaselineFromKeys(restored, []);
    assert.deepEqual(findUnsavedEntries(restored, baseline), []);
  });
});
