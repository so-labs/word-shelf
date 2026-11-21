import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { serializeGoogleIme } from "./core/google-ime";
import { parseMasterTsv, serializeMasterTsv } from "./core/master-tsv";
import { serializeMicrosoftIme } from "./core/microsoft-ime";
import { PARTS_OF_SPEECH, toMsImeConversion } from "./core/pos";
import type { DictionaryEntry } from "./core/types";
import {
  MASTER_FILE_NAME,
  DriveConflictError,
  clearDriveBaseline,
  driveAccountHint,
  driveConnect,
  driveDisconnect,
  driveIsConfigured,
  driveIsConnected,
  driveOpenMaster,
  driveSaveFiles,
} from "./drive";
import {
  DEFAULT_EXPORT_TARGETS,
  EXPORT_TARGETS_KEY,
  parseExportTargets,
  type ExportTargets,
} from "./core/export-targets";
import {
  AI_PROMPT_NOTICE_KEY,
  buildAiPrompt,
  buildChatGptUrl,
  buildClaudeUrl,
  selectAiExamples,
} from "./core/ai-prompt";
import { findSimilarEntries } from "./core/similar";
import { loadSharedFile } from "./core/shared-file";
import {
  findUnsavedEntries,
  savedBaselineFromKeys,
  unsavedContentKeys,
} from "./core/unsaved";
import { clearWorkCopy, loadWorkCopy, saveWorkCopy, type WorkCopy } from "./core/work-copy";

// 既定の並び順: 分類（Primary→Secondary）→読み順
function compareEntries(a: DictionaryEntry, b: DictionaryEntry): number {
  return (
    a.primary.localeCompare(b.primary, "ja") ||
    a.secondary.localeCompare(b.secondary, "ja") ||
    a.reading.localeCompare(b.reading, "ja")
  );
}

// 検索の一致場所による優先順位です。単語・読みの一致を先に、
// 分類の一致、コメントのみの一致の順に並べます。
function searchRank(entry: DictionaryEntry, query: string): number {
  const q = query.toLowerCase();
  if (entry.word.toLowerCase().includes(q) || entry.reading.toLowerCase().includes(q)) {
    return 0;
  }
  if (entry.primary.toLowerCase().includes(q) || entry.secondary.toLowerCase().includes(q)) {
    return 1;
  }
  if (entry.comment.toLowerCase().includes(q)) return 2;
  return -1;
}

function isExcludedFromMs(pos: string): boolean {
  return toMsImeConversion(pos)?.kind === "excluded";
}

// 品詞のMicrosoft IME向け変換の説明文です。
function posNote(pos: string): { warn: boolean; text: string } {
  const conversion = toMsImeConversion(pos);
  if (!conversion) {
    return { warn: true, text: "正本の品詞（45種）にない値です。" };
  }
  if (conversion.kind === "excluded") {
    return {
      warn: true,
      text: "Microsoft IMEには対応する品詞がないため、Microsoft IME用の出力には含まれません。Google日本語入力／Gboard用にはそのまま出力されます。",
    };
  }
  if (conversion.kind === "mapped") {
    return {
      warn: false,
      text: `Microsoft IMEでは、意味の近い「${conversion.msPos}」として出力されます。Google日本語入力／Gboard用にはそのまま出力されます。`,
    };
  }
  if (conversion.msPos === pos) {
    return {
      warn: false,
      text: `Microsoft IMEでも「${pos}」として出力されます。`,
    };
  }
  return {
    warn: false,
    text: `Microsoft IMEでは品詞名が変わり、「${conversion.msPos}」として出力されます。`,
  };
}

function download(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const SAMPLE_ENTRIES: DictionaryEntry[] = [
  {
    primary: "人名",
    secondary: "歴史上の人物",
    reading: "とよとみひでよし",
    word: "豊臣秀吉",
    pos: "人名",
    comment:
      "サンプルデータです。分類の例: 大分類（Primary）が「人名」、小分類（Secondary）が「歴史上の人物」です。",
  },
  {
    primary: "暮らし",
    secondary: "料理",
    reading: "だし",
    word: "出汁",
    pos: "名詞",
    comment: "サンプルデータです。自由に編集・削除できます。",
  },
  {
    primary: "仕事",
    secondary: "ソフトウェア",
    reading: "すぷれっどしーと",
    word: "スプレッドシート",
    pos: "名詞",
    comment: "",
  },
  {
    primary: "品詞の例",
    secondary: "変換",
    reading: "そしきめい",
    word: "組織名の例",
    pos: "組織",
    comment: "「組織」はMicrosoft IMEでは「固有名詞」に寄せて出力されます。",
  },
  {
    primary: "品詞の例",
    secondary: "変換",
    reading: "さじぇすと",
    word: "サジェスト専用の例",
    pos: "サジェストのみ",
    comment: "Microsoft IME用の出力には含まれません（⚠の例）。",
  },
  {
    primary: "表現",
    secondary: "顔文字",
    reading: "かお",
    word: "(´∀｀)",
    pos: "顔文字",
    comment: "",
  },
];

const EMPTY_ENTRY: DictionaryEntry = {
  primary: "",
  secondary: "",
  reading: "",
  word: "",
  pos: "名詞",
  comment: "",
};

type FormState =
  | { kind: "new"; initial: DictionaryEntry }
  | { kind: "duplicate"; initial: DictionaryEntry }
  | { kind: "edit"; index: number; initial: DictionaryEntry };

// AIコメント提案の実行内容です。コピーするか、AIを開く（URL付き）か。
type AiAction = { kind: "copy" } | { kind: "open"; url: string };

// 横スクロールする要素を、PCのマウスでもドラッグやホイールで流せるように
// するフックです。スマホはタッチで流れます。ドラッグしたときのクリックは
// 無効にします。要素が後から現れたり消えたりする場合にも効くよう、
// コールバックrefを返します。
function useDragScrollRef<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  useEffect(() => {
    if (!el) return;
    let down = false;
    let moved = false;
    let startX = 0;
    let startScroll = 0;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      down = true;
      moved = false;
      startX = e.clientX;
      startScroll = el.scrollLeft;
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 5) moved = true;
      if (moved) el.scrollLeft = startScroll - dx;
    };
    const onUp = () => {
      down = false;
    };
    const onClickCapture = (e: MouseEvent) => {
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
        moved = false;
      }
    };
    // PCのマウスホイールでも横スクロールできるようにします。要素の上に
    // ポインタがある間は、端まで来てもページ側へスクロールを譲りません。
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (delta === 0) return;
      e.preventDefault();
      const max = el.scrollWidth - el.clientWidth;
      el.scrollLeft = Math.min(max, Math.max(0, el.scrollLeft + delta));
    };
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    el.addEventListener("click", onClickCapture, true);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      el.removeEventListener("click", onClickCapture, true);
      el.removeEventListener("wheel", onWheel);
    };
  }, [el]);
  return setEl;
}

export default function App() {
  const [entries, setEntries] = useState<DictionaryEntry[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  // 最後に保存（出力）した時点の登録一覧です。現在の entries と比べて、
  // まだ保存されていない追加・編集を見分けるために使います。
  const [savedEntries, setSavedEntries] = useState<DictionaryEntry[]>([]);
  const [restoreCopy, setRestoreCopy] = useState<WorkCopy | null>(null);
  const [loadingName, setLoadingName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<{
    name: string;
    entries: DictionaryEntry[];
  } | null>(null);

  const [query, setQuery] = useState("");
  const [primaryFilter, setPrimaryFilter] = useState<string | null>(null);
  const [secondaryFilter, setSecondaryFilter] = useState<string | null>(null);
  const [secondaryOpen, setSecondaryOpen] = useState(false);
  const [primaryOpen, setPrimaryOpen] = useState(false);

  const [form, setForm] = useState<FormState | null>(null);
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [driveConnected, setDriveConnected] = useState(false);
  const [driveSettingsError, setDriveSettingsError] = useState<string | null>(null);
  const [usageOpen, setUsageOpen] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [noteIndex, setNoteIndex] = useState<number | null>(null);
  const [showTopButton, setShowTopButton] = useState(false);
  const topNavRef = useRef(false);

  // バージョン表記は、sw.js の CACHE_NAME（正本）から抽出します。
  // バージョン文字列を他のファイルに直書きしないための仕組みです。
  useEffect(() => {
    fetch("./sw.js")
      .then((response) => response.text())
      .then((text) => {
        const match = text.match(/CACHE_NAME\s*=\s*"word-shelf-([^"]+)"/);
        if (match?.[1]) setAppVersion(match[1]);
      })
      .catch(() => {
        // 取得できない環境では、バージョンを表示しないだけです
      });
  }, []);

  // ある程度スクロールしたら「上へ戻る」ボタンを出します（スマホ向け）。
  // ボタンを押したら、その場で消します（戻る途中での再表示も抑えます）。
  useEffect(() => {
    const onScroll = () => {
      if (topNavRef.current) {
        if (window.scrollY <= 600) topNavRef.current = false;
        return;
      }
      setShowTopButton(window.scrollY > 600);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chipRowRef = useDragScrollRef<HTMLDivElement>();

  // 起動時に作業コピー（未出力のまま閉じた編集中の内容）が残っていれば、
  // 復元するか聞きます。
  useEffect(() => {
    void loadWorkCopy().then((copy) => {
      if (copy) setRestoreCopy(copy);
    });
  }, []);

  // 未出力の変更は作業コピーへ自動で退避します。出力済みになったら消します。
  // 退避には、未保存だった登録の控えも含めます（復元後に別枠を再現するため）。
  useEffect(() => {
    if (entries === null) return;
    const timer = setTimeout(() => {
      if (dirty) {
        void saveWorkCopy({
          entries,
          fileName,
          savedAt: new Date().toISOString(),
          unsavedKeys: unsavedContentKeys(entries, savedEntries),
        });
      } else {
        void clearWorkCopy();
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [entries, fileName, dirty, savedEntries]);

  // 品詞注記のツールチップは、外側を触る（クリック・タップ）と閉じます。
  useTooltipClose(noteIndex !== null, () => setNoteIndex(null));

  // 一覧の条件が変わったら、開いている注記は閉じます（別の行を指すため）。
  useEffect(() => {
    setNoteIndex(null);
  }, [query, primaryFilter, secondaryFilter]);

  // PCでは、未出力のままタブを閉じようとしたときにも警告を出します
  // （スマホでは当てにできないため、保険は作業コピーの退避が本命です）。
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // 開始画面に戻ります。未出力の変更がある場合は、作業コピーとして
  // 退避されたまま残り、次回開いたときに復元するか聞かれます。
  const closeSession = () => {
    setEntries(null);
    setFileName(null);
    setDirty(false);
    setSavedEntries([]);
    setForm(null);
    setDeleteIndex(null);
    setSecondaryOpen(false);
    setPrimaryOpen(false);
    setPendingImport(null);
    setExportOpen(false);
    setCloseConfirm(false);
    setQuery("");
    setPrimaryFilter(null);
    setSecondaryFilter(null);
  };

  const startSession = (
    next: DictionaryEntry[],
    name: string | null,
    fromDrive = false,
    baseline?: DictionaryEntry[],
  ) => {
    // Drive以外から開いたセッションでは、競合確認の控えを引き継ぎません。
    if (!fromDrive) clearDriveBaseline();
    setEntries(next);
    setFileName(name);
    setDirty(false);
    // 作業コピーの復元では、保存時点の一覧が別に再構成されて渡されます。
    setSavedEntries(baseline ?? next);
    setQuery("");
    setPrimaryFilter(null);
    setSecondaryFilter(null);
    setLoadError(null);
  };

  const handleFile = async (file: File) => {
    // 数千件のファイルは読み込みと描画に数秒かかるため、先に読み込み中表示を
    // 出してから処理します（表示が描画されるよう少し待ってから始めます）。
    setLoadingName(file.name);
    await new Promise((resolve) => setTimeout(resolve, 80));
    try {
      const text = await file.text();
      const parsed = parseMasterTsv(text);
      if (entries !== null) {
        setPendingImport({ name: file.name, entries: parsed });
      } else {
        startSession(parsed, file.name);
      }
    } catch (error) {
      setLoadError(
        `ファイルを読み込めませんでした。${error instanceof Error ? error.message : ""}`,
      );
    } finally {
      setLoadingName(null);
    }
  };

  // Google Drive上の正本を開きます。読み込み中表示やエラー表示は、
  // ファイルから開く場合と共通のものを使います。
  const handleDriveOpen = async () => {
    setLoadingName(MASTER_FILE_NAME);
    await new Promise((resolve) => setTimeout(resolve, 80));
    try {
      const text = await driveOpenMaster();
      const parsed = parseMasterTsv(text);
      startSession(parsed, MASTER_FILE_NAME, true);
    } catch (error) {
      setLoadError(
        `Google Driveから読み込めませんでした。${error instanceof Error ? error.message : ""}`,
      );
    } finally {
      setLoadingName(null);
    }
  };

  // 設定を開くたびに、Driveの接続状態（保存済みトークンの有効期限）を
  // 確認し直します。
  useEffect(() => {
    if (settingsOpen) {
      setDriveConnected(driveIsConnected());
      setDriveSettingsError(null);
    }
  }, [settingsOpen]);

  const handleDriveConnect = async () => {
    setDriveSettingsError(null);
    try {
      await driveConnect();
      setDriveConnected(true);
    } catch (error) {
      setDriveSettingsError(error instanceof Error ? error.message : "接続に失敗しました。");
    }
  };

  const handleDriveDisconnect = () => {
    driveDisconnect();
    setDriveConnected(false);
    setDriveSettingsError(null);
  };

  // 共有メニュー（Web Share Target）から開かれた場合は、Service Workerが
  // 一時置きしたファイルを起動時に1回だけ受け取って開きます。通常の
  // ファイル読み込みと同じ扱いにし、辞書を開いていた場合は handleFile
  // 側の確認モーダルに委ねます。目印のクエリはその場で消します。
  const sharedHandledRef = useRef(false);
  useEffect(() => {
    if (sharedHandledRef.current) return;
    if (!new URLSearchParams(window.location.search).has("shared")) return;
    sharedHandledRef.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    void loadSharedFile().then((file) => {
      if (file) void handleFile(file);
    });
    // 起動時に1回だけ処理するため、依存配列は空にします
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const primaries = useMemo(() => {
    if (!entries) return [];
    const counts = new Map<string, number>();
    entries.forEach((e) => counts.set(e.primary, (counts.get(e.primary) ?? 0) + 1));
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, "ja"));
  }, [entries]);

  const secondaries = useMemo(() => {
    if (!entries) return [];
    const counts = new Map<string, number>();
    entries
      .filter((e) => primaryFilter === null || e.primary === primaryFilter)
      .forEach((e) => counts.set(e.secondary, (counts.get(e.secondary) ?? 0) + 1));
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, "ja"));
  }, [entries, primaryFilter]);

  // フォームの分類候補用です（絞り込み状態に左右されない全体の一覧）。
  const allSecondaries = useMemo(() => {
    if (!entries) return [];
    return [...new Set(entries.map((e) => e.secondary))].sort((a, b) => a.localeCompare(b, "ja"));
  }, [entries]);

  const secondariesByPrimary = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!entries) return map;
    entries.forEach((e) => {
      const list = map.get(e.primary) ?? [];
      if (!list.includes(e.secondary)) list.push(e.secondary);
      map.set(e.primary, list);
    });
    map.forEach((list) => list.sort((a, b) => a.localeCompare(b, "ja")));
    return map;
  }, [entries]);

  const view = useMemo(() => {
    if (!entries) return [];
    const q = query.trim();
    const items = entries
      .map((entry, index) => ({ entry, index }))
      .filter(
        ({ entry }) =>
          (primaryFilter === null || entry.primary === primaryFilter) &&
          (secondaryFilter === null || entry.secondary === secondaryFilter),
      );
    if (q === "") {
      return items.sort((a, b) => compareEntries(a.entry, b.entry));
    }
    return items
      .map((item) => ({ ...item, rank: searchRank(item.entry, q) }))
      .filter((item) => item.rank >= 0)
      .sort((a, b) => a.rank - b.rank || compareEntries(a.entry, b.entry));
  }, [entries, query, primaryFilter, secondaryFilter]);

  // 保存時点から変わっている登録（追加・編集）です。一覧の上部に別枠で
  // まとめ、検索・絞り込み中は通常の一覧の中で目印を付けます。
  const unsavedItems = useMemo(() => {
    if (!entries) return [];
    const unsaved = new Set(findUnsavedEntries(entries, savedEntries));
    return entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => unsaved.has(entry));
  }, [entries, savedEntries]);
  const unsavedSet = useMemo(
    () => new Set(unsavedItems.map(({ entry }) => entry)),
    [unsavedItems],
  );
  const isFiltering = query.trim() !== "" || primaryFilter !== null || secondaryFilter !== null;
  // 別枠を出している間は、通常の一覧から未保存分を除いて二重表示を避けます。
  const mainView = isFiltering ? view : view.filter(({ entry }) => !unsavedSet.has(entry));

  const saveForm = (entry: DictionaryEntry) => {
    if (!form) return;
    if (form.kind === "edit") {
      setEntries((prev) => (prev ? prev.map((e, i) => (i === form.index ? entry : e)) : prev));
    } else {
      setEntries((prev) => (prev ? [...prev, entry] : [entry]));
    }
    setDirty(true);
  };

  const deleteEntry = (index: number) => {
    setEntries((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));
    setDirty(true);
    setDeleteIndex(null);
  };

  // 一覧のカード1件分の表示です。通常の一覧と未保存の別枠で共用します。
  const renderCard = ({ entry, index }: { entry: DictionaryEntry; index: number }) => {
    const unsaved = unsavedSet.has(entry);
    return (
      <article className={`card${unsaved ? " unsaved" : ""}`} key={index}>
        <div className="card-top">
          <span className="card-word">{entry.word}</span>
          <span className="card-reading">{entry.reading}</span>
          {unsaved && <span className="unsaved-badge">未保存</span>}
          {isExcludedFromMs(entry.pos) ? (
            <button
              className="pos-badge warn badge-btn"
              data-pos-note
              onClick={() => setNoteIndex(noteIndex === index ? null : index)}
              aria-expanded={noteIndex === index}
              aria-label={`${entry.pos}についての注記を開く`}
            >
              {entry.pos} ⚠
            </button>
          ) : (
            <span className="pos-badge">{entry.pos}</span>
          )}
        </div>
        <div className="card-class">
          {entry.primary}
          {entry.secondary && ` › ${entry.secondary}`}
        </div>
        {entry.comment && <div className="card-comment">{entry.comment}</div>}
        {noteIndex === index && <PosNote pos={entry.pos} tooltip />}
        <div className="card-actions">
          <button
            className="link-btn"
            onClick={() => setForm({ kind: "edit", index, initial: entry })}
          >
            編集
          </button>
          <button
            className="link-btn"
            onClick={() => setForm({ kind: "duplicate", initial: entry })}
          >
            複製して新規
          </button>
          <button className="link-btn danger" onClick={() => setDeleteIndex(index)}>
            削除
          </button>
        </div>
      </article>
    );
  };

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-title">
            <span className="gold">W</span>ord Shelf
          </div>
          {entries !== null && (
            <>
              <div className="header-count">{entries.length}件</div>
              {dirty && <div className="dirty-badge">未出力</div>}
            </>
          )}
          <div className="header-actions">
            {entries !== null && (
              <>
                <button
                  className="btn btn-header btn-small"
                  onClick={() => (dirty ? setCloseConfirm(true) : closeSession())}
                >
                  戻る
                </button>
                <button
                  className="btn btn-header btn-small"
                  onClick={() => fileInputRef.current?.click()}
                >
                  開く
                </button>
                <button className="btn btn-gold btn-small" onClick={() => setExportOpen(true)}>
                  出力
                </button>
              </>
            )}
            <button
              className="btn btn-header btn-small"
              onClick={() => setSettingsOpen(true)}
              aria-label="設定を開く"
            >
              ⚙<span className="hide-narrow"> 設定</span>
            </button>
          </div>
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept=".tsv,.txt,text/tab-separated-values"
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void handleFile(file);
        }}
      />

      {entries === null ? (
        <div className="start-screen">
          {loadError && <div className="error-banner">{loadError}</div>}
          <div className="start-card">
            <h1>Word Shelf</h1>
            <p>IMEのユーザー辞書を、正本ファイル（DictionaryMaster.tsv）で管理するツールです。</p>
            <p className="start-save-line">
              {driveIsConfigured()
                ? "編集が終わったら、「出力」から正本ファイルをダウンロードするか、Google Driveに保存してください。正式な保存はそれだけです。"
                : "編集が終わったら、「出力」から正本ファイルをダウンロードしてください。正式な保存はそれだけです。"}
            </p>
            <details className="start-details">
              <summary>使い方の詳しい説明</summary>
              <UsageContent />
            </details>
            <div className="start-actions">
              <button className="btn btn-brand" onClick={() => fileInputRef.current?.click()}>
                正本ファイルを開く
              </button>
              {driveIsConfigured() && (
                <button className="btn" onClick={() => void handleDriveOpen()}>
                  Google Driveから開く
                </button>
              )}
              <button className="btn" onClick={() => startSession([], null)}>
                新規作成（空の辞書から）
              </button>
              <button className="btn" onClick={() => startSession(SAMPLE_ENTRIES, null)}>
                サンプル入りで新規作成（分類の例つき）
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="main">
          {loadError && <div className="error-banner">{loadError}</div>}
          <div className="toolbar">
            <input
              className="search-input"
              type="search"
              placeholder="読み・単語・分類・コメントから検索"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="chip-area">
              <div className="chip-row" ref={chipRowRef}>
                <button
                  className={`chip${primaryFilter === null ? " active" : ""}`}
                  onClick={() => {
                    setPrimaryFilter(null);
                    setSecondaryFilter(null);
                  }}
                >
                  すべて<span className="chip-count">{entries.length}</span>
                </button>
                {primaries.map(({ name, count }) => (
                  <button
                    key={name}
                    className={`chip${primaryFilter === name ? " active" : ""}`}
                    onClick={() => {
                      setPrimaryFilter(name);
                      setSecondaryFilter(null);
                    }}
                  >
                    {name === "" ? "（分類なし）" : name}
                    <span className="chip-count">{count}</span>
                  </button>
                ))}
              </div>
              <button
                className="btn btn-small chip-more"
                onClick={() => setPrimaryOpen(true)}
                aria-label="Primaryの一覧を開く"
                title="Primaryの一覧"
              >
                …
              </button>
            </div>
            <div className="filter-row">
              <button className="btn btn-small" onClick={() => setSecondaryOpen(true)}>
                Secondaryで絞り込む
              </button>
              {secondaryFilter !== null && (
                <>
                  <span>Secondary: {secondaryFilter === "" ? "（なし）" : secondaryFilter}</span>
                  <button className="link-btn" onClick={() => setSecondaryFilter(null)}>
                    解除
                  </button>
                </>
              )}
              {fileName && <span>ファイル: {fileName}</span>}
            </div>
          </div>

          <div className="list-count">
            {view.length}件を表示{view.length !== entries.length && `（全${entries.length}件）`}
          </div>
          {dirty && (
            <div className="dirty-note">
              データは保存されていません。失いたくない場合、「出力」からダウンロードしてください。
            </div>
          )}

          {!isFiltering && unsavedItems.length > 0 && (
            <section className="unsaved-section">
              <div className="unsaved-heading">未保存の変更（{unsavedItems.length}件）</div>
              <p className="unsaved-text">
                次の登録は、まだ保存されていません。「出力」から保存してください。
              </p>
              <div className="card-list">{unsavedItems.map(renderCard)}</div>
            </section>
          )}

          {view.length === 0 ? (
            <div className="empty-note">
              {entries.length === 0
                ? "まだ登録がありません。「＋ 新規登録」から追加できます。"
                : "条件に合う登録がありません。検索や絞り込みを変えてみてください。"}
            </div>
          ) : mainView.length === 0 ? null : (
            <div className="card-list">{mainView.map(renderCard)}</div>
          )}

          {showTopButton && (
            <button
              className="top-btn"
              onClick={() => {
                topNavRef.current = true;
                setShowTopButton(false);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              aria-label="一番上へ戻る"
            >
              ↑
            </button>
          )}

          <button
            className="fab"
            onClick={() =>
              setForm({
                kind: "new",
                initial: {
                  ...EMPTY_ENTRY,
                  primary: primaryFilter ?? "",
                  secondary: secondaryFilter ?? "",
                },
              })
            }
          >
            ＋ 新規登録
          </button>
        </div>
      )}

      {primaryOpen && (
        <Modal title="Primaryで絞り込む" onClose={() => setPrimaryOpen(false)}>
          <div className="sheet-list">
            <button
              className={`sheet-item${primaryFilter === null ? " active" : ""}`}
              onClick={() => {
                setPrimaryFilter(null);
                setSecondaryFilter(null);
                setPrimaryOpen(false);
              }}
            >
              <span>すべて</span>
              <span className="chip-count">{entries?.length ?? 0}件</span>
            </button>
            {primaries.map(({ name, count }) => (
              <button
                key={name}
                className={`sheet-item${primaryFilter === name ? " active" : ""}`}
                onClick={() => {
                  setPrimaryFilter(name);
                  setSecondaryFilter(null);
                  setPrimaryOpen(false);
                }}
              >
                <span>{name === "" ? "（分類なし）" : name}</span>
                <span className="chip-count">{count}件</span>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {secondaryOpen && (
        <Modal title="Secondaryで絞り込む" onClose={() => setSecondaryOpen(false)}>
          <div className="sheet-list">
            <button
              className={`sheet-item${secondaryFilter === null ? " active" : ""}`}
              onClick={() => {
                setSecondaryFilter(null);
                setSecondaryOpen(false);
              }}
            >
              すべて
            </button>
            {secondaries.map(({ name, count }) => (
              <button
                key={name}
                className={`sheet-item${secondaryFilter === name ? " active" : ""}`}
                onClick={() => {
                  setSecondaryFilter(name);
                  setSecondaryOpen(false);
                }}
              >
                <span>{name === "" ? "（なし）" : name}</span>
                <span className="chip-count">{count}件</span>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {form && (
        <EntryForm
          key={`${form.kind}-${form.kind === "edit" ? form.index : "new"}`}
          form={form}
          entries={entries ?? []}
          primaries={primaries.map((p) => p.name)}
          secondaries={allSecondaries}
          secondariesByPrimary={secondariesByPrimary}
          onSave={saveForm}
          onClose={() => setForm(null)}
        />
      )}

      {deleteIndex !== null && entries && (
        <Modal title="削除の確認" onClose={() => setDeleteIndex(null)}>
          <p>
            「{entries[deleteIndex]?.word}
            」を削除しますか。出力するまではファイルに影響しませんが、この画面での削除は取り消せません。
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setDeleteIndex(null)}>
              キャンセル
            </button>
            <button className="btn btn-danger" onClick={() => deleteEntry(deleteIndex)}>
              削除する
            </button>
          </div>
        </Modal>
      )}

      {pendingImport && (
        <Modal title="ファイルを開きますか" onClose={() => setPendingImport(null)}>
          <p>
            いま開いている辞書（{entries?.length ?? 0}件）を閉じて、「{pendingImport.name}」（
            {pendingImport.entries.length}件）を開きます。
            {dirty && "未出力の変更は失われます。"}
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setPendingImport(null)}>
              キャンセル
            </button>
            <button
              className="btn btn-brand"
              onClick={() => {
                startSession(pendingImport.entries, pendingImport.name);
                setPendingImport(null);
              }}
            >
              開く
            </button>
          </div>
        </Modal>
      )}

      {settingsOpen && (
        <Modal title="設定" onClose={() => setSettingsOpen(false)}>
          <div className="settings-section">
            <div className="settings-label">テーマ</div>
            <p className="settings-desc">アプリの外観切り替え</p>
            <div className="theme-toggle-row">
              <ThemeToggle />
            </div>
          </div>
          <div className="settings-section">
            <div className="settings-label">Google Drive</div>
            {driveIsConfigured() ? (
              <>
                <p className="settings-desc">
                  {driveConnected
                    ? `接続中${driveAccountHint() ? `（${driveAccountHint()}）` : ""}。開始画面からDrive上の正本を開けます。`
                    : "未接続。接続すると、開始画面からDrive上の正本を開いたり、出力時にDriveへ保存したりできます。"}
                </p>
                {driveSettingsError && <div className="error-banner">{driveSettingsError}</div>}
                {driveConnected ? (
                  <button className="btn" onClick={handleDriveDisconnect}>
                    接続を解除
                  </button>
                ) : (
                  <button className="btn" onClick={() => void handleDriveConnect()}>
                    Google Driveに接続
                  </button>
                )}
              </>
            ) : (
              <p className="settings-desc">
                クライアントIDが設定されていないため、利用できません。
              </p>
            )}
          </div>
          <div className="settings-section">
            <div className="settings-label">使い方</div>
            <p className="settings-desc">基本の流れや、保存についての注意を確認できます。</p>
            <button
              className="btn"
              onClick={() => {
                setSettingsOpen(false);
                setUsageOpen(true);
              }}
            >
              使い方を表示
            </button>
          </div>
          <div className="settings-version">Ver. {appVersion ?? "-"}</div>
          <div className="settings-privacy">
            <a href="./privacy.html" target="_blank" rel="noopener noreferrer">
              プライバシーポリシー
            </a>
          </div>
        </Modal>
      )}

      {usageOpen && (
        <Modal title="使い方" onClose={() => setUsageOpen(false)}>
          <UsageContent />
        </Modal>
      )}

      {exportOpen && entries && (
        <ExportModal
          entries={entries}
          onClose={() => setExportOpen(false)}
          onMasterExported={() => {
            setDirty(false);
            if (entries) setSavedEntries(entries);
          }}
        />
      )}

      {loadingName && (
        <div className="loading-overlay" role="status" aria-live="polite">
          <div className="spinner" />
          <div className="loading-text">{loadingName}を読み込んでいます…</div>
          <div className="loading-sub">件数が多いファイルでは、数秒かかることがあります</div>
        </div>
      )}

      {closeConfirm && (
        <Modal title="ホーム画面に戻る" onClose={() => setCloseConfirm(false)}>
          <p>未出力の変更があります。保存してないデータは失われます。</p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setCloseConfirm(false)}>
              キャンセル
            </button>
            <button className="btn btn-danger" onClick={closeSession}>
              戻る
            </button>
          </div>
        </Modal>
      )}

      {restoreCopy && entries === null && (
        <Modal title="編集中の内容が残っています" onClose={() => setRestoreCopy(null)}>
          <p>
            前回、出力せずに閉じた内容（{restoreCopy.entries.length}件
            {restoreCopy.fileName && `、ファイル: ${restoreCopy.fileName}`}、
            {new Date(restoreCopy.savedAt).toLocaleString("ja-JP")}
            に退避）が残っています。復元しても「未出力」の状態のままです。
          </p>
          <div className="modal-actions">
            <button
              className="btn"
              onClick={() => {
                void clearWorkCopy();
                setRestoreCopy(null);
              }}
            >
              破棄する
            </button>
            <button
              className="btn btn-brand"
              onClick={() => {
                const copy = restoreCopy;
                setRestoreCopy(null);
                setLoadingName("作業コピー");
                setTimeout(() => {
                  startSession(
                    copy.entries,
                    copy.fileName,
                    false,
                    copy.unsavedKeys
                      ? savedBaselineFromKeys(copy.entries, copy.unsavedKeys)
                      : undefined,
                  );
                  setDirty(true);
                  setLoadingName(null);
                }, 80);
              }}
            >
              復元する
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

type ThemePref = "light" | "system" | "dark";
const THEME_STORAGE_KEY = "word-shelf:theme";

function resolveTheme(pref: ThemePref): "light" | "dark" {
  if (pref === "dark") return "dark";
  if (pref === "light") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// テーマごとのステータスバー（theme-color）の色です。ヘッダーの背景と揃えます。
const THEME_COLORS: Record<"light" | "dark", string> = {
  light: "#1F3A5F",
  dark: "#0D141D",
};

// 解決したテーマを画面とステータスバーへ反映します。
function applyTheme(resolved: "light" | "dark") {
  document.documentElement.dataset.theme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLORS[resolved]);
}

// テーマ切り替えです。他のプロジェクトと揃えて、ライト／システム／ダークの
// 3択セグメント＋localStorage（word-shelf:theme）にしています。
function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  });

  useEffect(() => {
    applyTheme(resolveTheme(pref));
    localStorage.setItem(THEME_STORAGE_KEY, pref);
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      applyTheme(resolveTheme("system"));
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  const options: { value: ThemePref; label: string; icon: string }[] = [
    { value: "light", label: "ライト", icon: "☀" },
    { value: "system", label: "システム", icon: "◐" },
    { value: "dark", label: "ダーク", icon: "☾" },
  ];
  return (
    <div className="theme-toggle" role="group" aria-label="テーマ切り替え">
      {options.map(({ value, label, icon }) => (
        <button
          key={value}
          className={pref === value ? "active" : ""}
          onClick={() => setPref(value)}
          aria-pressed={pref === value}
        >
          <span className="theme-icon">{icon}</span>
          {label}
        </button>
      ))}
    </div>
  );
}

// 使い方の本文です。開始画面の詳しい説明と、設定メニューから開く
// 「使い方」モーダルで同じ内容を使います。
function UsageContent() {
  const driveReady = driveIsConfigured();
  return (
    <div className="usage-body">
      <h3>基本の流れ</h3>
      <p>
        ファイルを開いて編集し、出力で正本とIME用辞書ファイルを書き出します。次回は、ダウンロードした正本ファイルをもう一度開いて続きを編集します。
        スマートフォンでは、ファイルアプリやGoogle Driveアプリの共有メニューで正本ファイルを選び、このアプリで開くこともできます。
        {driveReady &&
          "Google Driveに接続すると、開始画面からDrive上の正本を開いたり、出力のときにDriveへ保存したりもできます。"}
      </p>
      <h3>分類の付け方（任意）</h3>
      <p>
        各単語には分類を2段で付けられます。大分類（Primary）と、その中の小分類（Secondary）です。たとえば
        Primary「人名」／Secondary「歴史上の人物」、Primary「暮らし」／Secondary「料理」のように付けると、一覧を分類で絞り込んで眺められます。付け方は自由で、空欄でも構いません。サンプル入りで新規作成すると、分類の例を見られます。
      </p>
      <h3>⚠ 重要: 保存について</h3>
      <p>
        {driveReady
          ? "正式な保存は、正本ファイルのダウンロード、またはGoogle Driveへの保存だけです。編集中の内容はこの端末に自動で一時退避され、リロードや開き直しをしても、次に開いたときに復元するか聞かれます。ただし一時退避はブラウザの都合で消えることもある保険なので、編集が終わったら必ず正本をダウンロードするか、Driveに保存してください。"
          : "正式な保存は、正本ファイルのダウンロードだけです。編集中の内容はこの端末に自動で一時退避され、リロードや開き直しをしても、次に開いたときに復元するか聞かれます。ただし一時退避はブラウザの都合で消えることもある保険なので、編集が終わったら必ず正本をダウンロードしてください。"}
      </p>
    </div>
  );
}

// ツールチップ共通の閉じ方です。開いている間、外側を押す（クリック・
// タップ）と閉じます。開くボタンとツールチップ自身には data-pos-note を
// 付けておき、その内側は閉じる対象にしません。フォームとカードで共用します。
function useTooltipClose(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[data-pos-note]")) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
}

// 品詞の変換注記です。登録フォームと一覧カードで、同じ内容を共通で
// ツールチップ表示します（DRY）。
function PosNote({ pos, tooltip = false }: { pos: string; tooltip?: boolean }) {
  const note = posNote(pos);
  const box = <div className={`pos-note${note.warn ? " warn" : ""}`}>{note.text}</div>;
  if (!tooltip) return box;
  return (
    <div className="pos-tooltip" data-pos-note>
      {box}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-label={title}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function EntryForm({
  form,
  entries,
  primaries,
  secondaries,
  secondariesByPrimary,
  onSave,
  onClose,
}: {
  form: FormState;
  entries: DictionaryEntry[];
  primaries: string[];
  secondaries: string[];
  secondariesByPrimary: Map<string, string[]>;
  onSave: (entry: DictionaryEntry) => void;
  onClose: () => void;
}) {
  const [fields, setFields] = useState<DictionaryEntry>(form.initial);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState(false);
  // AIコメント提案の開閉、コピー完了の表示、送る前の注意喚起の状態です。
  const [aiOpen, setAiOpen] = useState(false);
  const [aiCopied, setAiCopied] = useState(false);
  const [aiNoticeAction, setAiNoticeAction] = useState<AiAction | null>(null);
  const [aiNoticeMute, setAiNoticeMute] = useState(false);
  // 「コピーしました」の表示は、数秒たったら自動で消します。
  useEffect(() => {
    if (!aiCopied) return;
    const timer = window.setTimeout(() => setAiCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [aiCopied]);
  const [showNote, setShowNote] = useState(isExcludedFromMs(form.initial.pos));
  useTooltipClose(showNote, () => setShowNote(false));
  const [focusedField, setFocusedField] = useState<"primary" | "secondary" | null>(null);

  // 分類の入力候補です。ブラウザ標準の候補表示（datalist）はスマホで表示が
  // 安定しないため、候補チップを自前で出します。
  const suggest = (list: string[], current: string): string[] =>
    list
      .filter(
        (name) => name !== "" && name !== current && (current === "" || name.includes(current)),
      )
      .slice(0, 8);

  const primarySuggestions = suggest(primaries, fields.primary);
  const secondarySource =
    fields.primary !== "" && secondariesByPrimary.has(fields.primary)
      ? (secondariesByPrimary.get(fields.primary) ?? [])
      : secondaries;
  const secondarySuggestions = suggest(secondarySource, fields.secondary);

  // 候補チップの並びも、PCではドラッグやホイールで横スクロールできるように
  // します（一覧のチップ列と同じフックを使います）。
  const primarySuggestRef = useDragScrollRef<HTMLDivElement>();
  const secondarySuggestRef = useDragScrollRef<HTMLDivElement>();

  const suggestionChips = (key: "primary" | "secondary", list: string[]): ReactNode =>
    focusedField === key &&
    list.length > 0 && (
      <div
        className="suggest-row"
        ref={key === "primary" ? primarySuggestRef : secondarySuggestRef}
      >
        {list.map((name) => (
          <button
            key={name}
            type="button"
            className="suggest-chip"
            onMouseDown={(e) => {
              // 入力欄からフォーカスが外れないようにするだけにして、選択は
              // クリックで確定させます（ドラッグスクロールの直後にクリックが
              // 効いてしまわないようにするためです）。
              e.preventDefault();
            }}
            onClick={() => set(key, name)}
          >
            {name}
          </button>
        ))}
      </div>
    );

  const set = (key: keyof DictionaryEntry, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }));
    setNotice(false);
  };

  const validate = (): boolean => {
    if (fields.reading.trim() === "" || fields.word.trim() === "") {
      setError("読みと単語は必須です。");
      return false;
    }
    setError(null);
    return true;
  };

  const title =
    form.kind === "edit" ? "編集" : form.kind === "duplicate" ? "複製して新規登録" : "新規登録";

  const excluded = isExcludedFromMs(fields.pos);

  // 入力した単語と似た登録です。保存は妨げず、伝えるだけにします。
  const similarEntries = useMemo(
    () => findSimilarEntries(entries, fields.word, form.kind === "edit" ? form.index : null),
    [entries, fields.word, form],
  );

  // AIコメント提案: 参考例は、いま入力中の分類に合わせて選び直します。
  const aiExamples = useMemo(
    () =>
      selectAiExamples(
        entries,
        { primary: fields.primary, secondary: fields.secondary },
        form.initial,
      ),
    [entries, fields.primary, fields.secondary, form.initial],
  );
  const aiPrompt = useMemo(
    () => buildAiPrompt(fields.word.trim(), aiExamples),
    [fields.word, aiExamples],
  );
  const aiWordMissing = fields.word.trim() === "";
  // プレビューで編集したプロンプトです。未編集の間は生成結果に追従し、
  // 編集を始めたら、単語や分類を変えても上書きしません（作り直すで戻せます）。
  const [aiPromptText, setAiPromptText] = useState<string | null>(null);
  const displayedPrompt = aiPromptText ?? aiPrompt;
  const aiPromptEdited = aiPromptText !== null && aiPromptText !== aiPrompt;

  const copyText = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // クリップボードAPIが使えない環境向けの代替手段です。
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      document.body.removeChild(ta);
      return ok;
    }
  };

  const runAiAction = async (action: AiAction) => {
    if (action.kind === "copy") {
      if (await copyText(displayedPrompt)) setAiCopied(true);
    } else {
      // 開き先でプロンプトが渡らなかった場合に備え、コピーもしておきます。
      await copyText(displayedPrompt);
      window.open(action.url, "_blank", "noopener");
    }
  };

  // 初回は、参考例に個人情報が含まれ得ることの注意喚起を挟みます。
  const requestAiAction = (action: AiAction) => {
    let muted = false;
    try {
      muted = localStorage.getItem(AI_PROMPT_NOTICE_KEY) === "muted";
    } catch {
      muted = false;
    }
    if (muted) {
      void runAiAction(action);
    } else {
      setAiNoticeMute(false);
      setAiNoticeAction(action);
    }
  };

  const confirmAiNotice = () => {
    if (aiNoticeMute) {
      try {
        localStorage.setItem(AI_PROMPT_NOTICE_KEY, "muted");
      } catch {
        // 保存できなくても動作は続けます（毎回表示されるだけです）。
      }
    }
    const action = aiNoticeAction;
    setAiNoticeAction(null);
    if (action) void runAiAction(action);
  };

  return (
    <>
      <Modal title={title} onClose={onClose}>
        {notice && (
          <div className="form-notice">
            保存しました。いまの内容を引き継いでいます。書き換える欄だけ直して、次の登録ができます。
          </div>
        )}
        <div className="field">
          <label htmlFor="f-primary">分類（Primary）</label>
          <input
            id="f-primary"
            placeholder="例: 人名、暮らし、仕事"
            value={fields.primary}
            onChange={(e) => set("primary", e.target.value)}
            onFocus={() => setFocusedField("primary")}
          />
          {suggestionChips("primary", primarySuggestions)}
          <div className="field-hint">大きな分類です。一覧のチップで絞り込む軸になります。</div>
        </div>
        <div className="field">
          <label htmlFor="f-secondary">分類（Secondary）</label>
          <input
            id="f-secondary"
            placeholder="例: 歴史上の人物、料理、ソフトウェア"
            value={fields.secondary}
            onChange={(e) => set("secondary", e.target.value)}
            onFocus={() => setFocusedField("secondary")}
          />
          {suggestionChips("secondary", secondarySuggestions)}
          <div className="field-hint">Primaryの中の小分類です。絞り込みシートで選べます。</div>
        </div>
        <div className="field">
          <label htmlFor="f-reading">読み</label>
          <input
            id="f-reading"
            value={fields.reading}
            onChange={(e) => set("reading", e.target.value)}
            onFocus={() => setFocusedField(null)}
          />
        </div>
        <div className="field">
          <label htmlFor="f-word">単語</label>
          <input
            id="f-word"
            value={fields.word}
            onChange={(e) => set("word", e.target.value)}
            onFocus={() => setFocusedField(null)}
          />
          {similarEntries.length > 0 && (
            <div className="similar-note">
              似た登録があります
              <ul>
                {similarEntries.map((e, i) => (
                  <li key={i}>
                    {e.word}（{e.reading}／{e.pos}）
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="field">
          <label htmlFor="f-pos">品詞</label>
          <div className="pos-wrap">
            <div className="pos-row">
              <select
                id="f-pos"
                value={fields.pos}
                onChange={(e) => {
                  set("pos", e.target.value);
                  if (isExcludedFromMs(e.target.value)) setShowNote(true);
                }}
              >
                {PARTS_OF_SPEECH.map((pos) => (
                  <option key={pos} value={pos}>
                    {pos}
                    {isExcludedFromMs(pos) ? " ⚠" : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={`pos-note-toggle${excluded ? " warn" : ""}`}
                data-pos-note
                aria-label="品詞の変換についての注記を開く"
                aria-expanded={showNote}
                onClick={() => setShowNote((prev) => !prev)}
              >
                {excluded ? "⚠" : "？"}
              </button>
            </div>
            {showNote && <PosNote pos={fields.pos} tooltip />}
          </div>
        </div>
        <div className="field">
          <label htmlFor="f-comment">コメント</label>
          <textarea
            id="f-comment"
            value={fields.comment}
            onChange={(e) => set("comment", e.target.value)}
          />
        </div>
        <div className="ai-help">
          <button
            type="button"
            className="ai-help-toggle"
            aria-expanded={aiOpen}
            onClick={() => setAiOpen((prev) => !prev)}
          >
            AIにコメントを提案してもらう {aiOpen ? "▲" : "▼"}
          </button>
          {aiOpen && (
            <div className="ai-help-body">
              <p className="ai-help-note">外部のAIに聞くためのプロンプトを作ります。</p>
              <textarea
                className="ai-prompt-edit"
                rows={9}
                value={aiWordMissing ? "" : displayedPrompt}
                placeholder="（単語を入力すると表示されます）"
                disabled={aiWordMissing}
                onChange={(e) => setAiPromptText(e.target.value)}
                aria-label="AIへ渡すプロンプト（編集できます）"
              />
              {aiPromptEdited && (
                <div className="ai-help-reset">
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => setAiPromptText(null)}
                  >
                    プロンプトを作り直す
                  </button>
                </div>
              )}
              <div className="ai-help-actions">
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={aiWordMissing}
                  onClick={() => requestAiAction({ kind: "copy" })}
                >
                  コピー
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={aiWordMissing}
                  onClick={() =>
                    requestAiAction({ kind: "open", url: buildChatGptUrl(displayedPrompt) })
                  }
                >
                  ChatGPTで開く
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={aiWordMissing}
                  onClick={() =>
                    requestAiAction({ kind: "open", url: buildClaudeUrl(displayedPrompt) })
                  }
                >
                  Claudeで開く
                </button>
              </div>
              {aiCopied && <div className="form-notice">コピーしました。</div>}
            </div>
          )}
        </div>
        {error && <div className="field-error">{error}</div>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            キャンセル
          </button>
          {form.kind !== "edit" && (
            <button
              className="btn btn-gold"
              onClick={() => {
                if (!validate()) return;
                onSave(fields);
                setNotice(true);
              }}
            >
              保存して続けて登録
            </button>
          )}
          <button
            className="btn btn-brand"
            onClick={() => {
              if (!validate()) return;
              onSave(fields);
              onClose();
            }}
          >
            保存
          </button>
        </div>
      </Modal>
      {aiNoticeAction && (
        <Modal title="AIに送る前の確認" onClose={() => setAiNoticeAction(null)}>
          <p>
            プロンプトには、参考例として他の登録の単語とコメントが含まれます。送りたくない情報（実名・住所など）があれば、プレビューで消してから開いてください。
          </p>
          <label className="export-check">
            <input
              type="checkbox"
              checked={aiNoticeMute}
              onChange={(e) => setAiNoticeMute(e.target.checked)}
            />
            次回から表示しない
          </label>
          <div className="modal-actions">
            <button className="btn" onClick={() => setAiNoticeAction(null)}>
              キャンセル
            </button>
            <button className="btn btn-brand" onClick={confirmAiNotice}>
              確認して続ける
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function ExportModal({
  entries,
  onClose,
  onMasterExported,
}: {
  entries: DictionaryEntry[];
  onClose: () => void;
  onMasterExported: () => void;
}) {
  // IME用ファイルのチェックは端末に覚えさせ、次回も同じ選択から
  // 始められるようにします（既定は両方ON）。
  const [targets, setTargets] = useState<ExportTargets>(() => {
    try {
      return parseExportTargets(localStorage.getItem(EXPORT_TARGETS_KEY));
    } catch {
      return { ...DEFAULT_EXPORT_TARGETS };
    }
  });
  const includeGoogle = targets.google;
  const includeMs = targets.microsoft;
  const updateTargets = (next: ExportTargets) => {
    setTargets(next);
    try {
      localStorage.setItem(EXPORT_TARGETS_KEY, JSON.stringify(next));
    } catch {
      // 保存できなくても、今回の出力は続けられます
    }
  };
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveSaved, setDriveSaved] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [driveConflictAt, setDriveConflictAt] = useState<string | null>(null);

  const masterText = useMemo(() => serializeMasterTsv(entries), [entries]);
  const googleText = useMemo(() => serializeGoogleIme(entries), [entries]);
  const msResult = useMemo(() => serializeMicrosoftIme(entries), [entries]);

  // 正本は保存忘れを防ぐため常時含みます。まとめてダウンロードでは
  // 正本を最初に落とし、続けてチェックしたIME用ファイルを落とします。
  const downloadAll = () => {
    download("DictionaryMaster.tsv", masterText, "text/tab-separated-values;charset=utf-8");
    onMasterExported();
    if (includeGoogle) {
      download("Dictionary_GoogleIME.txt", googleText, "text/plain;charset=utf-8");
    }
    if (includeMs) {
      download("Dictionary_MicrosoftIME.txt", msResult.bytes, "application/octet-stream");
    }
  };

  // Driveへの保存もダウンロードと同じ正式な保存です。正本は常時含み、
  // IME用ファイルはチェックしたものだけを同じフォルダへ保存します。
  // Drive側の正本が開いた後に変わっていた場合は、まず競合を知らせて
  // 上書きの確認を取ります。
  const saveToDrive = async (force: boolean) => {
    setDriveBusy(true);
    setDriveSaved(false);
    setDriveError(null);
    try {
      const files = [
        {
          name: "DictionaryMaster.tsv",
          body: new Blob([masterText], { type: "text/tab-separated-values" }),
        },
      ];
      if (includeGoogle) {
        files.push({
          name: "Dictionary_GoogleIME.txt",
          body: new Blob([googleText], { type: "text/plain" }),
        });
      }
      if (includeMs) {
        files.push({
          name: "Dictionary_MicrosoftIME.txt",
          body: new Blob([msResult.bytes as BlobPart], { type: "application/octet-stream" }),
        });
      }
      await driveSaveFiles(files, { force });
      setDriveConflictAt(null);
      setDriveSaved(true);
      onMasterExported();
    } catch (error) {
      if (error instanceof DriveConflictError) {
        setDriveConflictAt(error.remoteModifiedTime);
      } else {
        setDriveError(
          `Google Driveに保存できませんでした。${error instanceof Error ? error.message : ""}`,
        );
      }
    } finally {
      setDriveBusy(false);
    }
  };

  return (
    <Modal title="出力" onClose={onClose}>
      <div className="export-file">
        <div className="file-name">DictionaryMaster.tsv（正本）</div>
        <div className="file-desc">
          いまの辞書の内容そのものです（{entries.length}
          件）。保存忘れを防ぐため、常時含まれます。このファイルが唯一の正式な保存で、次回はこのファイルを開いて続きを編集します。
        </div>
      </div>

      <div className="export-file">
        <label className="export-check">
          <input
            type="checkbox"
            checked={includeGoogle}
            onChange={(e) => updateTargets({ ...targets, google: e.target.checked })}
          />
          <span className="file-name">Dictionary_GoogleIME.txt</span>
        </label>
        <div className="file-desc">
          Google日本語入力／Gboard用です。全{entries.length}
          件を、読み／単語／品詞／コメントの4列で出力します。
        </div>
      </div>

      <div className="export-file">
        <label className="export-check">
          <input
            type="checkbox"
            checked={includeMs}
            onChange={(e) => updateTargets({ ...targets, microsoft: e.target.checked })}
          />
          <span className="file-name">Dictionary_MicrosoftIME.txt</span>
        </label>
        <div className="file-desc">
          Microsoft IME用です。
          {msResult.outputCount}件を出力します（品詞を変換したものを含みます）。
        </div>
        <details className="breakdown">
          <summary>変換と除外の内訳を見る</summary>
          そのまま・名前の変更のみで対応: {msResult.directCount}件
          <br />
          意味の近い品詞へ寄せて対応: {msResult.mappedCount}件
          <br />
          対応する品詞がなく除外: {msResult.excludedCount}件
          {Object.entries(msResult.excludedByPos).map(([pos, count]) => (
            <span key={pos}>
              <br />- {pos}: {count}件
            </span>
          ))}
        </details>
      </div>

      {driveConflictAt && (
        <div className="error-banner">
          Google Drive上の正本が、開いた後に変更されています（更新:{" "}
          {new Date(driveConflictAt).toLocaleString("ja-JP")}
          ）。この内容で上書きしてよいですか？
          <div className="modal-actions">
            <button className="btn" onClick={() => setDriveConflictAt(null)}>
              キャンセル
            </button>
            <button
              className="btn btn-danger"
              disabled={driveBusy}
              onClick={() => void saveToDrive(true)}
            >
              上書きして保存
            </button>
          </div>
        </div>
      )}
      {driveError && <div className="error-banner">{driveError}</div>}
      {driveSaved && <p className="settings-desc">Google Driveに保存しました。</p>}

      <div className="modal-actions export-actions">
        <button className="btn" onClick={onClose}>
          閉じる
        </button>
        {driveIsConfigured() && (
          <button
            className="btn btn-brand"
            disabled={driveBusy}
            onClick={() => void saveToDrive(false)}
          >
            {driveBusy ? "保存しています…" : "Driveに保存"}
          </button>
        )}
        <button className="btn btn-gold" onClick={downloadAll}>
          まとめてダウンロード
        </button>
      </div>
    </Modal>
  );
}
