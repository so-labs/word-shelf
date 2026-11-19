// 辞書の1件分のデータ。正本ファイルの6列と対応します。
export interface DictionaryEntry {
  primary: string;
  secondary: string;
  reading: string;
  word: string;
  pos: string;
  comment: string;
}
