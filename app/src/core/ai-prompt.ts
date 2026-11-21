import type { DictionaryEntry } from "./types";

// AIチャットへ渡すプロンプトの組み立てです。アプリにAIを組み込むのではなく、
// ユーザーが普段使っているAIチャット（検索機能つき）に、コメントの説明文の
// 下書きを作ってもらうための材料を用意します。

// 送る前の注意喚起を「次回から表示しない」にした控えの保存先です。
export const AI_PROMPT_NOTICE_KEY = "word-shelf:ai-prompt-notice";

// 参考例として使えるコメントの最小の長さです。空欄や5文字程度の短いものは
// 長さと書き方の見本にならないため、参考例からは除きます。
export const MIN_EXAMPLE_COMMENT_LENGTH = 6;

// 参考例の件数です。
export const EXAMPLE_COUNT = 5;

export type AiExample = { word: string; comment: string };

// 参考例に使える登録がない場合の予備の例です。一般的な単語だけで構成し、
// 個人のデータは含みません。例自体が長さの上限（20文字）を超えていると
// 回答も長くなりやすいため、例も上限以内に収めています。
export const FALLBACK_EXAMPLES: AiExample[] = [
  { word: "豊臣秀吉", comment: "天下統一を成し遂げた戦国武将。" },
  { word: "出汁", comment: "昆布や鰹節から取るうま味の汁。" },
  { word: "スプレッドシート", comment: "表形式で計算や集計を行うソフトウェア。" },
  { word: "忖度", comment: "相手の気持ちを推し量って配慮すること。" },
  { word: "一期一会", comment: "一度きりの出会いを大切にする心得。" },
];

// 配列をランダムな順序に並べ替えた新しい配列を返します。テストで順序を
// 固定できるよう、乱数の発生源を差し替えられるようにしています。
function shuffled<T>(list: T[], random: () => number): T[] {
  const result = [...list];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = result[i];
    const b = result[j];
    if (a === undefined || b === undefined) continue;
    result[i] = b;
    result[j] = a;
  }
  return result;
}

// プロンプトに入れる参考例を選びます。優先順位は「対象と同じPrimaryかつ
// 同じSecondary」「同じPrimaryで別のSecondary」「全体」の順で、各段から
// ランダムに拾って EXAMPLE_COUNT 件まで埋めます。Secondaryは別のPrimaryに
// 同じ名前があり得るため、Primaryが違うものは最初の段には混ぜません。
// 足りない場合は FALLBACK_EXAMPLES で補います。
export function selectAiExamples(
  entries: DictionaryEntry[],
  target: { primary: string; secondary: string },
  exclude: DictionaryEntry | null,
  random: () => number = Math.random,
): AiExample[] {
  const eligible = entries.filter(
    (e) =>
      e !== exclude &&
      e.word.trim() !== "" &&
      e.comment.trim().length >= MIN_EXAMPLE_COMMENT_LENGTH,
  );
  const pools = [
    eligible.filter((e) => e.primary === target.primary && e.secondary === target.secondary),
    eligible.filter((e) => e.primary === target.primary && e.secondary !== target.secondary),
    eligible.filter((e) => e.primary !== target.primary),
  ];
  const picked: AiExample[] = [];
  for (const pool of pools) {
    for (const entry of shuffled(pool, random)) {
      if (picked.length >= EXAMPLE_COUNT) break;
      picked.push({ word: entry.word, comment: entry.comment });
    }
    if (picked.length >= EXAMPLE_COUNT) break;
  }
  for (const example of FALLBACK_EXAMPLES) {
    if (picked.length >= EXAMPLE_COUNT) break;
    picked.push(example);
  }
  return picked;
}

// AIチャットへ渡すプロンプト本文を組み立てます。参考例は「単語」と「説明」を
// 行で分けて示し、最後に対象の単語と出力の形を置きます。参考例を1行の
// 「単語：説明」の形で並べると、回答がその形を真似て前置きを付けてしまう
// ことがあるためです。参考例は長さと書き方の形式を真似るためだけのもので、
// 対象の単語の意味を推測させないこと、分からない場合は推測せず「不明」と
// 返すことも明記します。
export function buildAiPrompt(word: string, examples: AiExample[]): string {
  const lines = [
    "次の条件で、ある単語の説明を作ってください。",
    "",
    "・知識だけではなく、検索機能を用いて調べてください。",
    "・出典、脚注、Markdown、引用符は含めないでください。",
    "・検索しても確かな情報が分からない場合は、推測で書かずに「不明」とだけ出力してください。",
    "・参考例は長さと書き方の形式を真似るためだけのものです。対象の単語の意味を推測する根拠にしないでください。",
    "",
    "参考例:",
    ...examples.flatMap((e) => [`単語：${e.word}`, `説明：${e.comment}`]),
    "",
    `対象の単語：「${word}」`,
    "この単語を、必ず20文字以内で説明してください。超えそうな場合は、要点だけに削って短く言い換えてください。「単語：」のような前置きは付けず、説明の文だけを出力してください。",
  ];
  return lines.join("\n");
}

// ChatGPTを、プロンプトが入力された状態で開くためのURLです。検索の指定や
// 一時チャットなどの追加パラメータは非公式で、いつ廃止されてもおかしくない
// ため付けません。環境によっては開くと同時に送信まで進みますが、渡すのは
// プレビューで確認・編集済みの内容です。
export function buildChatGptUrl(prompt: string): string {
  return `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`;
}

// Claudeを、プロンプトが入力された状態で開くためのURLです。
export function buildClaudeUrl(prompt: string): string {
  return `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
}
