// 出力モーダルで選んだIME用ファイルの対象（チェックボックス）の控えです。
// 端末ごとに覚えておき、次に開いたときも同じ選択から始められるように
// localStorageへ保存します。正本は常時含まれるため、対象外です。
export const EXPORT_TARGETS_KEY = "word-shelf:export-targets";

export interface ExportTargets {
  google: boolean;
  microsoft: boolean;
}

// 控えがない・壊れている場合の既定は、両方ONです。
export const DEFAULT_EXPORT_TARGETS: ExportTargets = { google: true, microsoft: true };

// 保存済みの文字列を読み解きます。項目ごとに真偽値でなければ既定へ倒し、
// 壊れた値でも両方ONからやり直せるようにします。
export function parseExportTargets(raw: string | null): ExportTargets {
  if (raw === null) return { ...DEFAULT_EXPORT_TARGETS };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_EXPORT_TARGETS };
    const value = parsed as Partial<ExportTargets>;
    return {
      google: typeof value.google === "boolean" ? value.google : DEFAULT_EXPORT_TARGETS.google,
      microsoft:
        typeof value.microsoft === "boolean" ? value.microsoft : DEFAULT_EXPORT_TARGETS.microsoft,
    };
  } catch {
    return { ...DEFAULT_EXPORT_TARGETS };
  }
}
