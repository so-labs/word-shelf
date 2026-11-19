import type { DictionaryEntry } from "./types";

// 作業コピーの自動退避です。編集中（未出力）の内容をIndexedDBへ一時的に
// 保存し、リロードや再起動で消えてしまわないようにします。
// 正式な保存は正本ファイルだけであり、退避は保険として扱います。
export interface WorkCopy {
  entries: DictionaryEntry[];
  fileName: string | null;
  savedAt: string;
}

const DB_NAME = "word-shelf";
const STORE_NAME = "session";
const KEY = "work-copy";

// 保存された値が作業コピーの形をしているかを確認します。
export function isWorkCopy(value: unknown): value is WorkCopy {
  if (typeof value !== "object" || value === null) return false;
  const copy = value as Partial<WorkCopy>;
  return (
    Array.isArray(copy.entries) &&
    copy.entries.every(
      (e) =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as DictionaryEntry).reading === "string" &&
        typeof (e as DictionaryEntry).word === "string",
    ) &&
    (typeof copy.fileName === "string" || copy.fileName === null) &&
    typeof copy.savedAt === "string"
  );
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// 退避は保険なので、失敗しても編集の邪魔をしないよう、エラーは握りつぶします。
export async function loadWorkCopy(): Promise<WorkCopy | null> {
  try {
    const db = await openDb();
    const value: unknown = await runRequest(
      db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(KEY),
    );
    return isWorkCopy(value) ? value : null;
  } catch {
    return null;
  }
}

export async function saveWorkCopy(copy: WorkCopy): Promise<void> {
  try {
    const db = await openDb();
    await runRequest(
      db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(copy, KEY),
    );
  } catch {
    // 退避できなくても編集は続けられます
  }
}

export async function clearWorkCopy(): Promise<void> {
  try {
    const db = await openDb();
    await runRequest(db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(KEY));
  } catch {
    // 消せなくても実害はありません
  }
}
