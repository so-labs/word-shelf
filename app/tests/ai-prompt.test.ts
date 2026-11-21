import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXAMPLE_COUNT,
  FALLBACK_EXAMPLES,
  buildAiPrompt,
  buildChatGptUrl,
  buildClaudeUrl,
  selectAiExamples,
} from "../src/core/ai-prompt";
import type { DictionaryEntry } from "../src/core/types";

const entry = (partial: Partial<DictionaryEntry>): DictionaryEntry => ({
  primary: "仕事",
  secondary: "ソフトウェア",
  reading: "よみ",
  word: "単語",
  pos: "名詞",
  comment: "これは十分な長さの説明文です",
  ...partial,
});

// 乱数を固定し、並べ替えの結果を安定させます。
const fixedRandom = () => 0.5;

describe("AIプロンプトの参考例の選択", () => {
  it("同じPrimary・同じSecondaryから優先して選ぶ", () => {
    const entries = [
      entry({ word: "同分類1", comment: "同じ分類の説明文その一です" }),
      entry({ word: "同分類2", comment: "同じ分類の説明文その二です" }),
      entry({ word: "同分類3", comment: "同じ分類の説明文その三です" }),
      entry({ word: "同分類4", comment: "同じ分類の説明文その四です" }),
      entry({ word: "同分類5", comment: "同じ分類の説明文その五です" }),
      entry({ word: "他分類", primary: "暮らし", secondary: "料理", comment: "他の分類の説明文です" }),
    ];
    const picked = selectAiExamples(
      entries,
      { primary: "仕事", secondary: "ソフトウェア" },
      null,
      fixedRandom,
    );
    assert.equal(picked.length, EXAMPLE_COUNT);
    assert.ok(picked.every((e) => e.word.startsWith("同分類")));
  });

  it("別のPrimaryにある同じ名前のSecondaryからは巻き込まない", () => {
    const entries = [
      entry({ word: "同分類1", comment: "同じ分類の説明文その一です" }),
      entry({ word: "同分類2", comment: "同じ分類の説明文その二です" }),
      entry({ word: "同分類3", comment: "同じ分類の説明文その三です" }),
      entry({ word: "同分類4", comment: "同じ分類の説明文その四です" }),
      entry({ word: "同分類5", comment: "同じ分類の説明文その五です" }),
      entry({
        word: "別Primary同名",
        primary: "暮らし",
        secondary: "ソフトウェア",
        comment: "別の分類の説明文です",
      }),
    ];
    const picked = selectAiExamples(
      entries,
      { primary: "仕事", secondary: "ソフトウェア" },
      null,
      fixedRandom,
    );
    assert.ok(picked.every((e) => e.word !== "別Primary同名"));
  });

  it("同分類で足りない場合は同じPrimaryの別Secondary、次に全体で補う", () => {
    const entries = [
      entry({ word: "同分類1", comment: "同じ分類の説明文その一です" }),
      entry({ word: "別Secondary", secondary: "事務", comment: "同じPrimaryの別の小分類です" }),
      entry({ word: "他分類", primary: "暮らし", secondary: "料理", comment: "他の分類の説明文です" }),
    ];
    const picked = selectAiExamples(
      entries,
      { primary: "仕事", secondary: "ソフトウェア" },
      null,
      fixedRandom,
    );
    assert.equal(picked.length, EXAMPLE_COUNT);
    assert.deepEqual(
      picked.slice(0, 3).map((e) => e.word),
      ["同分類1", "別Secondary", "他分類"],
    );
  });

  it("コメントが空欄や短いもの、対象自身は参考例から除く", () => {
    const target = entry({ word: "対象", comment: "対象自身の説明文は十分長い" });
    const entries = [
      target,
      entry({ word: "空欄", comment: "" }),
      entry({ word: "短い", comment: "5文字以下" }),
      entry({ word: "有効", comment: "使える説明文はこれだけです" }),
    ];
    const picked = selectAiExamples(
      entries,
      { primary: "仕事", secondary: "ソフトウェア" },
      target,
      fixedRandom,
    );
    assert.equal(picked[0]?.word, "有効");
    assert.ok(picked.every((e) => e.word !== "対象" && e.word !== "空欄" && e.word !== "短い"));
  });

  it("使える登録がない場合は予備の例で埋める", () => {
    const picked = selectAiExamples([], { primary: "", secondary: "" }, null, fixedRandom);
    assert.deepEqual(picked, FALLBACK_EXAMPLES.slice(0, EXAMPLE_COUNT));
  });
});

describe("AIプロンプトの組み立て", () => {
  it("対象の単語と守りごと、参考例を含む", () => {
    const prompt = buildAiPrompt("対象語", [{ word: "例の単語", comment: "例の説明文です" }]);
    assert.ok(prompt.includes("検索機能を用いて"));
    assert.ok(prompt.includes("「不明」とだけ出力してください"));
    assert.ok(prompt.includes("推測する根拠にしないでください"));
    // 参考例は「単語」と「説明」を行で分けて示します。
    assert.ok(prompt.includes("単語：例の単語\n説明：例の説明文です"));
    // 対象の単語と、前置きを付けない指示は最後に置きます。
    assert.ok(prompt.includes("対象の単語：「対象語」"));
    assert.ok(
      prompt.endsWith(
        "この単語を、必ず20文字以内で説明してください。超えそうな場合は、要点だけに削って短く言い換えてください。「単語：」のような前置きは付けず、説明の文だけを出力してください。",
      ),
    );
  });

  it("予備の固定例は、長さの上限（20文字）以内に収まっている", () => {
    for (const example of FALLBACK_EXAMPLES) {
      assert.ok([...example.comment].length <= 20, example.word);
    }
  });

  it("AIを開くURLはプロンプトをエンコードして入れる", () => {
    const prompt = "あ い";
    assert.equal(buildChatGptUrl(prompt), `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`);
    assert.equal(buildClaudeUrl(prompt), `https://claude.ai/new?q=${encodeURIComponent(prompt)}`);
  });
});
