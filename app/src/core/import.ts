import { MASTER_HEADER, parseMasterTsv } from "./master-tsv";
import { MS_IME_CONVERSION, PARTS_OF_SPEECH, fromMsImePos, isPartOfSpeech } from "./pos";
import type { DictionaryEntry } from "./types";
import { extractZipEntry } from "./zip";

// 辞書ファイルの取り込みです。
// 形式ごとの差異は ImportFormat の「定義」に寄せ、判定→行の読み込み→
// 登録への変換という共通の流れで処理します。対応形式を増やすときは、
// IMPORT_FORMATS へ定義を1つ足すのが基本形です。タブ区切りで列の割り当てが
// 違うだけの形式なら、defineTsvFormat で足せます。

// 分類を持たない形式から取り込んだ登録の置き場です。
export const IMPORT_PRIMARY = "未分類";

export interface ImportResult {
  // 判定した形式の表示名です。
  formatLabel: string;
  // 取り込み確認で伝える補足（分類の置き場、欠ける情報など）です。
  note: string | null;
  entries: DictionaryEntry[];
}

interface ImportFormat {
  id: string;
  label: string;
  note: string | null;
  detect: (text: string, fileName: string) => boolean;
  parse: (text: string) => DictionaryEntry[];
}

function stripBom(text: string): string {
  return text.startsWith("\uFEFF") ? text.slice(1) : text;
}

function firstLineOf(text: string): string {
  return text.split(/\r\n|\n/, 1)[0] ?? "";
}

// 判定材料として、データ行のセルをすべて返します。コメント行（「#」や
// 「!」で始まる行）は除きます。決め手になる品詞が末尾近くにしか現れない
// ファイルもあるため、先頭だけでなく全体を見ます。
function dataRows(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of stripBom(text).split(/\r\n|\n/)) {
    if (line.trim() === "" || line.startsWith("#") || line.startsWith("!")) continue;
    rows.push(line.split("\t"));
  }
  return rows;
}

// タブ区切りテキスト形式の共通定義です。列の割り当てと、行の読み飛ばし・
// 絞り込み、品詞の変換だけを形式ごとに指定します。読みと単語が空の行は
// 取り込みません。品詞の列がない、または空の場合は「名詞」にします。
interface TsvFormatOptions {
  id: string;
  label: string;
  note: string | null;
  detect: (text: string, fileName: string) => boolean;
  columns: {
    reading: number;
    word: number;
    pos?: number;
    comment?: number;
  };
  // この接頭辞で始まる行（ヘッダーやコメント）を読み飛ばします。
  skipLinePrefixes?: string[];
  // 取り込む行だけを残す絞り込みです（言語タグの判定など）。
  rowFilter?: (cells: string[]) => boolean;
  // 品詞の変換です。省略した場合は、正本の品詞にない値を「名詞」にします。
  convertPos?: (pos: string) => string;
}

function defineTsvFormat(options: TsvFormatOptions): ImportFormat {
  const convertPos =
    options.convertPos ?? ((pos: string) => (isPartOfSpeech(pos) ? pos : "名詞"));
  return {
    id: options.id,
    label: options.label,
    note: options.note,
    detect: (text, fileName) => options.detect(stripBom(text), fileName),
    parse: (rawText) => {
      const entries: DictionaryEntry[] = [];
      for (const line of stripBom(rawText).split(/\r\n|\n/)) {
        if (line.trim() === "") continue;
        if (options.skipLinePrefixes?.some((prefix) => line.startsWith(prefix))) continue;
        const cells = line.split("\t");
        if (options.rowFilter && !options.rowFilter(cells)) continue;
        const cell = (index: number | undefined): string =>
          index === undefined ? "" : (cells[index] ?? "");
        const reading = cell(options.columns.reading);
        const word = cell(options.columns.word);
        if (reading === "" || word === "") continue;
        const rawPos = cell(options.columns.pos);
        entries.push({
          primary: IMPORT_PRIMARY,
          secondary: "",
          reading,
          word,
          pos: convertPos(rawPos === "" ? "名詞" : rawPos),
          comment: cell(options.columns.comment),
        });
      }
      return entries;
    },
  };
}

// Microsoft IMEの品詞名の一覧です（変換表から作ります）。
const MS_POS_NAMES: ReadonlySet<string> = new Set(
  PARTS_OF_SPEECH.flatMap((pos) => {
    const conversion = MS_IME_CONVERSION[pos];
    return conversion.kind === "excluded" ? [] : [conversion.msPos];
  }),
);

// その形式でしか使わない品詞名が含まれているかどうかで、Microsoft IME形式と
// Google系形式を見分けるための判定材料です。どちらの体系にもある品詞名
// （名詞、人名など）だけでは決め手になりません。
function hasDecisivePos(rows: string[][], kind: "ms" | "google"): boolean {
  return rows.some((cells) => {
    const pos = cells[2] ?? "";
    const isMsOnly = MS_POS_NAMES.has(pos) && !isPartOfSpeech(pos);
    const isGoogleOnly = isPartOfSpeech(pos) && !MS_POS_NAMES.has(pos);
    return kind === "ms" ? isMsOnly : isGoogleOnly;
  });
}

// 正本ファイルです。形式が厳密に決まっているため、共通の枠組みではなく
// 専用の読み込み（parseMasterTsv）をそのまま使います。
const masterFormat: ImportFormat = {
  id: "master",
  label: "正本ファイル",
  note: null,
  detect: (text) => firstLineOf(text) === MASTER_HEADER.join("\t"),
  parse: (text) => parseMasterTsv(text),
};

// Gboardの書き出しです。ZIPの中の dictionary.txt がこの形で、
// 「#」のヘッダー行に形式名と列名が書かれています。列は
// 読み／単語／言語タグ／品詞で、コメントはありません。品詞の列がない
// 古い書き出し（3列）も、品詞なしとして受け付けます。
const gboardFormat = defineTsvFormat({
  id: "gboard",
  label: "Gboard",
  note: `分類は「${IMPORT_PRIMARY}」に入ります。コメントは含まれません。`,
  detect: (text) => firstLineOf(text).startsWith("# Gboard Dictionary"),
  columns: { reading: 0, word: 1, pos: 3 },
  skipLinePrefixes: ["#"],
  // 言語タグが日本語（ja始まり）の行だけを取り込みます。
  rowFilter: (cells) => {
    const tag = cells[2] ?? "";
    return tag === "" || tag.toLowerCase().startsWith("ja");
  },
});

// Microsoft IMEの辞書ファイルです。UTF-16LEのデコードは呼び出し側で
// 済んでいる前提で、ここではテキストの形だけを見ます。先頭には「!」で
// 始まるツール情報の行があり、列は読み／単語／品詞／コメントの4列です
// （コメントの列がない3列の書き出しもあります）。
const microsoftImeFormat = defineTsvFormat({
  id: "microsoft-ime",
  label: "Microsoft IME",
  note: `分類は「${IMPORT_PRIMARY}」に入ります。品詞は近いものに置き換える場合があります。`,
  detect: (text, fileName) => {
    if (fileName === "Dictionary_MicrosoftIME.txt") return true;
    const rows = dataRows(text);
    if (rows.length === 0) return false;
    if (hasDecisivePos(rows, "ms")) return true;
    // 決め手になる品詞がない場合は、3列だけの形をMicrosoft IMEとみなします
    // （Google日本語入力の書き出しは常に4列です）。どちらの体系にもある
    // 品詞名だけのファイルは、判定が違っても読み込み結果は同じです。
    return rows.every((cells) => cells.length === 3);
  },
  columns: { reading: 0, word: 1, pos: 2, comment: 3 },
  skipLinePrefixes: ["!"],
  convertPos: (pos) => fromMsImePos(pos) ?? "名詞",
});

// Google日本語入力の辞書ファイルです。列は読み／単語／品詞／コメントの
// 4列で、このアプリのGoogle系出力と同じ形です。
const googleImeFormat = defineTsvFormat({
  id: "google-ime",
  label: "Google日本語入力",
  note: `分類は「${IMPORT_PRIMARY}」に入ります。`,
  detect: (text, fileName) => {
    if (fileName === "Dictionary_GoogleIME.txt") return true;
    const rows = dataRows(text);
    if (rows.length === 0) return false;
    if (hasDecisivePos(rows, "google")) return true;
    return rows.every((cells) => cells.length >= 4);
  },
  columns: { reading: 0, word: 1, pos: 2, comment: 3 },
});

// 対応する形式の一覧です。判定はこの並び順に行い、最初に一致した形式で
// 読み込みます（正本→Gboard→Microsoft IME→Google日本語入力）。
const IMPORT_FORMATS: ImportFormat[] = [
  masterFormat,
  gboardFormat,
  microsoftImeFormat,
  googleImeFormat,
];

// テキスト化した辞書ファイルを取り込みます。形式は自動で判定します。
export function parseDictionaryText(text: string, fileName: string): ImportResult {
  for (const format of IMPORT_FORMATS) {
    if (format.detect(text, fileName)) {
      return { formatLabel: format.label, note: format.note, entries: format.parse(text) };
    }
  }
  throw new Error("対応する辞書形式が分かりませんでした");
}

// 辞書ファイルのバイト列を取り込みます。コンテナと文字コードの違い
// （ZIP、UTF-16、UTF-8）はここで吸収し、テキスト化してから形式を判定
// します。
export async function parseDictionaryFile(
  bytes: Uint8Array,
  fileName: string,
): Promise<ImportResult> {
  let text: string;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    // ZIP（Gboardの書き出し）です。辞書本体のテキストを取り出します。
    const entry = await extractZipEntry(bytes, "dictionary.txt");
    text = new TextDecoder("utf-8").decode(entry.data);
  } else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    text = new TextDecoder("utf-16le").decode(bytes.subarray(2));
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    text = new TextDecoder("utf-16be").decode(bytes.subarray(2));
  } else {
    text = new TextDecoder("utf-8").decode(bytes);
  }
  return parseDictionaryText(text, fileName);
}
