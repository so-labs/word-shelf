// 正本の品詞は、Google日本語入力の品詞体系45種を基準とします。
// 45種すべてが設計対象で、実際に使われていない品詞も削りません。
export const PARTS_OF_SPEECH = [
  "品詞なし",
  "名詞",
  "短縮よみ",
  "サジェストのみ",
  "固有名詞",
  "人名",
  "姓",
  "名",
  "組織",
  "地名",
  "名詞サ変",
  "名詞形動",
  "数",
  "アルファベット",
  "記号",
  "顔文字",
  "副詞",
  "連体詞",
  "接続詞",
  "感動詞",
  "接頭語",
  "助数詞",
  "接尾一般",
  "接尾人名",
  "接尾地名",
  "動詞ワ行五段",
  "動詞カ行五段",
  "動詞サ行五段",
  "動詞タ行五段",
  "動詞ナ行五段",
  "動詞マ行五段",
  "動詞ラ行五段",
  "動詞ガ行五段",
  "動詞バ行五段",
  "動詞ハ行四段",
  "動詞一段",
  "動詞カ変",
  "動詞サ変",
  "動詞ザ変",
  "動詞ラ変",
  "形容詞",
  "終助詞",
  "句読点",
  "独立語",
  "抑制単語",
] as const;

export type PartOfSpeech = (typeof PARTS_OF_SPEECH)[number];

const PART_OF_SPEECH_SET: ReadonlySet<string> = new Set(PARTS_OF_SPEECH);

export function isPartOfSpeech(value: string): value is PartOfSpeech {
  return PART_OF_SPEECH_SET.has(value);
}

// Microsoft IME向けの変換の種類です。
// - direct: そのまま、または名前が変わるだけで対応します。
// - mapped: 意味の近い別の品詞へ寄せて対応します。
// - excluded: 対応する品詞がないため、Microsoft IME用の出力に含めません。
export type MsImeConversion =
  { kind: "direct"; msPos: string } | { kind: "mapped"; msPos: string } | { kind: "excluded" };

const direct = (msPos: string): MsImeConversion => ({ kind: "direct", msPos });
const mapped = (msPos: string): MsImeConversion => ({ kind: "mapped", msPos });
const excluded: MsImeConversion = { kind: "excluded" };

// Microsoft IME向けの品詞変換表です。msPosは辞書ファイル上の品詞名で、
// 単語登録画面の表示名とは異なる場合があります（例: 地名→地名その他）。
export const MS_IME_CONVERSION: Record<PartOfSpeech, MsImeConversion> = {
  品詞なし: mapped("名詞"),
  名詞: direct("名詞"),
  短縮よみ: direct("短縮よみ"),
  サジェストのみ: excluded,
  固有名詞: direct("固有名詞"),
  人名: direct("人名"),
  姓: direct("姓"),
  名: direct("名"),
  組織: mapped("固有名詞"),
  地名: direct("地名その他"),
  名詞サ変: direct("さ変名詞"),
  名詞形動: direct("形動名詞"),
  数: mapped("名詞"),
  アルファベット: mapped("名詞"),
  記号: mapped("名詞"),
  顔文字: direct("顔文字"),
  副詞: direct("副詞"),
  連体詞: direct("連体詞"),
  接続詞: direct("接続詞"),
  感動詞: direct("感動詞"),
  接頭語: direct("接頭語"),
  助数詞: direct("助数詞"),
  接尾一般: direct("接尾語"),
  接尾人名: direct("姓名接尾語"),
  接尾地名: direct("地名接尾語"),
  動詞ワ行五段: direct("あわ行五段"),
  動詞カ行五段: direct("か行五段"),
  動詞サ行五段: direct("さ行五段"),
  動詞タ行五段: direct("た行五段"),
  動詞ナ行五段: direct("な行五段"),
  動詞マ行五段: direct("ま行五段"),
  動詞ラ行五段: direct("ら行五段"),
  動詞ガ行五段: direct("が行五段"),
  動詞バ行五段: direct("ば行五段"),
  動詞ハ行四段: excluded,
  動詞一段: direct("一段動詞"),
  動詞カ変: excluded,
  動詞サ変: excluded,
  動詞ザ変: excluded,
  動詞ラ変: excluded,
  形容詞: direct("形容詞"),
  終助詞: excluded,
  句読点: mapped("名詞"),
  独立語: mapped("慣用句"),
  抑制単語: excluded,
};

// 正本の品詞からMicrosoft IME向けの変換を引きます。
// 正本の45種にない品詞が渡された場合は undefined を返します。
export function toMsImeConversion(pos: string): MsImeConversion | undefined {
  if (!isPartOfSpeech(pos)) return undefined;
  return MS_IME_CONVERSION[pos];
}
