// Google Drive 連携です。保存先は通常ストレージの「Word Shelf」フォルダで、
// 正本とIME用ファイルをそのままの形で置きます（利用者から見える資産として
// 扱うため、アプリ専用領域は使いません）。
// スコープは drive.file（このアプリが作ったファイルだけが見える範囲）に
// 限ります。そのため既存の同名フォルダは検索できず、フォルダとファイルは
// このアプリが作成したものだけを対象にします。初回の保存でフォルダを
// 作成し、以後は名前で探して使い続けます。
// 認証は Google Identity Services のトークン方式で、サーバーも
// クライアントシークレットも使いません。クライアントIDは公開情報ですが、
// コードには書かず環境変数 VITE_GOOGLE_CLIENT_ID から読み込みます
// （本番はGitHub ActionsのVariables、ローカルは app/.env.local）。
// アクセストークンは有効期限（最大1時間）の間だけブラウザ内に保存し、
// 開き直しても再認証を省けるようにします。
const GOOGLE_CLIENT_ID: string = import.meta.env?.VITE_GOOGLE_CLIENT_ID ?? "";
const GOOGLE_DRIVE_SCOPE =
  "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email";
const LOGIN_HINT_KEY = "word-shelf:drive-login-hint";
const TOKEN_KEY = "word-shelf:drive-token";
const BASELINE_KEY = "word-shelf:drive-baseline";
const GIS_SCRIPT_URL = "https://accounts.google.com/gsi/client";
const DRIVE_API_BASE = "https://www.googleapis.com";

export const DRIVE_FOLDER_NAME = "Word Shelf";
export const MASTER_FILE_NAME = "DictionaryMaster.tsv";

// ---------- Google Identity Services の最小限の型 ----------
interface GisTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}
interface GisTokenClient {
  requestAccessToken(params: { prompt: string; login_hint?: string }): void;
}
interface GisOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (response: GisTokenResponse) => void;
    error_callback?: (error: { type?: string; message?: string }) => void;
  }): GisTokenClient;
  revoke(accessToken: string, done: () => void): void;
}
declare global {
  interface Window {
    google?: { accounts: { oauth2: GisOAuth2 } };
  }
}

// ---------- 競合確認の基準（ベースライン） ----------
// Driveから正本を開いた時点（または保存した時点）のファイルIDと更新日時を
// 控えておき、次に保存する前に、Drive側がその後変わっていないか比べます。
export interface DriveBaseline {
  fileId: string;
  modifiedTime: string;
}

export function isDriveBaseline(value: unknown): value is DriveBaseline {
  if (typeof value !== "object" || value === null) return false;
  const base = value as Partial<DriveBaseline>;
  return typeof base.fileId === "string" && typeof base.modifiedTime === "string";
}

export function loadDriveBaseline(): DriveBaseline | null {
  try {
    const raw = localStorage.getItem(BASELINE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isDriveBaseline(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function saveDriveBaseline(base: DriveBaseline): void {
  try {
    localStorage.setItem(BASELINE_KEY, JSON.stringify(base));
  } catch {
    // 控えが保存できなくても、今回の保存自体は完了として扱います
  }
}

export function clearDriveBaseline(): void {
  try {
    localStorage.removeItem(BASELINE_KEY);
  } catch {
    // 消せなくても実害はありません
  }
}

// 保存前の競合判定です。控えがないのにDrive側に正本がある場合（別の端末で
// 先に保存していた等）も、上書きになるので競合として扱います。
export function detectDriveConflict(
  baseline: DriveBaseline | null,
  remote: DriveBaseline | null,
): boolean {
  if (remote === null) return false;
  if (baseline === null) return true;
  return baseline.fileId !== remote.fileId || baseline.modifiedTime !== remote.modifiedTime;
}

// 競合が見つかったときに投げるエラーです。UI側はこれを受けて、
// Drive側の更新日時を示して上書きするか確認します。
export class DriveConflictError extends Error {
  readonly remoteModifiedTime: string;
  constructor(remoteModifiedTime: string) {
    super("Google Drive上の正本が、開いた後に変更されています。");
    this.name = "DriveConflictError";
    this.remoteModifiedTime = remoteModifiedTime;
  }
}

// ---------- トークン管理 ----------
let accessToken: string | null = null;
let accessTokenExpiresAt = 0;

function loadStoredToken(): { token: string; expiresAt: number } | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as { token?: unknown; expiresAt?: unknown };
    if (typeof parsed.token !== "string" || typeof parsed.expiresAt !== "number") return null;
    return { token: parsed.token, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

function saveStoredToken(): void {
  if (accessToken === null) return;
  try {
    localStorage.setItem(
      TOKEN_KEY,
      JSON.stringify({ token: accessToken, expiresAt: accessTokenExpiresAt }),
    );
  } catch {
    // 保存できなくても、今回のセッションでは接続を続けられます
  }
}

function clearStoredToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // 消せなくても実害はありません
  }
}

function hasUsableToken(): boolean {
  if (accessToken !== null && Date.now() < accessTokenExpiresAt - 60_000) return true;
  const stored = loadStoredToken();
  if (stored === null) return false;
  if (Date.now() >= stored.expiresAt - 60_000) {
    clearStoredToken();
    return false;
  }
  accessToken = stored.token;
  accessTokenExpiresAt = stored.expiresAt;
  return true;
}

let tokenClient: GisTokenClient | null = null;
let gisLoadPromise: Promise<void> | null = null;
let pendingTokenRequest: {
  resolve: (token: string) => void;
  reject: (error: Error) => void;
} | null = null;

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisLoadPromise) {
    gisLoadPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = GIS_SCRIPT_URL;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        gisLoadPromise = null;
        reject(new Error("Googleの認証ライブラリを読み込めませんでした。通信環境を確認してください。"));
      };
      document.head.appendChild(script);
    });
  }
  return gisLoadPromise;
}

async function requestAccessToken(): Promise<string> {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error(
      "Google DriveのクライアントIDが設定されていません。環境変数 VITE_GOOGLE_CLIENT_ID を設定してください。",
    );
  }
  if (hasUsableToken()) return accessToken!;
  await loadGis();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) throw new Error("Googleの認証ライブラリを利用できませんでした。");
  if (!tokenClient) {
    tokenClient = oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_DRIVE_SCOPE,
      callback: (response) => {
        const pending = pendingTokenRequest;
        pendingTokenRequest = null;
        if (!pending) return;
        if (response.error || !response.access_token) {
          pending.reject(new Error("Googleアカウントの認証に失敗しました。"));
          return;
        }
        accessToken = response.access_token;
        accessTokenExpiresAt = Date.now() + (response.expires_in ?? 3600) * 1000;
        saveStoredToken();
        pending.resolve(accessToken);
        if (!localStorage.getItem(LOGIN_HINT_KEY)) void rememberLoginHint(accessToken);
      },
      error_callback: (error) => {
        const pending = pendingTokenRequest;
        pendingTokenRequest = null;
        if (!pending) return;
        if (error?.type === "popup_failed_to_open") {
          pending.reject(
            new Error(
              "認証用のポップアップを開けませんでした。ブラウザの設定で、このサイトのポップアップを許可してください。",
            ),
          );
        } else if (error?.type === "popup_closed") {
          pending.reject(new Error("Googleアカウントの認証がキャンセルされました。"));
        } else {
          pending.reject(new Error("Googleアカウントの認証に失敗しました。"));
        }
      },
    });
  }
  // 認証リクエストはボタンのクリックから直接1回だけ行い、前回接続した
  // アカウントの控え（login_hint）を渡してアカウント選択を省きます。
  const hint = localStorage.getItem(LOGIN_HINT_KEY);
  return new Promise<string>((resolve, reject) => {
    pendingTokenRequest = { resolve, reject };
    tokenClient!.requestAccessToken(
      hint ? { prompt: "", login_hint: hint } : { prompt: "" },
    );
  });
}

async function rememberLoginHint(token: string): Promise<void> {
  try {
    const res = await fetch(`${DRIVE_API_BASE}/oauth2/v3/userinfo`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const data = (await res.json()) as { email?: string };
    if (data.email) localStorage.setItem(LOGIN_HINT_KEY, data.email);
  } catch {
    // 控えは無くても連携できるので、失敗しても何もしません
  }
}

async function driveRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await requestAccessToken();
  const res = await fetch(`${DRIVE_API_BASE}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    accessToken = null;
    accessTokenExpiresAt = 0;
    clearStoredToken();
    throw new Error("認証の有効期限が切れました。もう一度お試しください。");
  }
  return res;
}

// ---------- 接続状態 ----------
export function driveIsConfigured(): boolean {
  return GOOGLE_CLIENT_ID !== "";
}

export function driveIsConnected(): boolean {
  return hasUsableToken();
}

export function driveAccountHint(): string | null {
  try {
    return localStorage.getItem(LOGIN_HINT_KEY);
  } catch {
    return null;
  }
}

export async function driveConnect(): Promise<void> {
  await requestAccessToken();
}

export function driveDisconnect(): void {
  const token = accessToken ?? loadStoredToken()?.token ?? null;
  accessToken = null;
  accessTokenExpiresAt = 0;
  clearStoredToken();
  try {
    localStorage.removeItem(LOGIN_HINT_KEY);
  } catch {
    // 消せなくても実害はありません
  }
  clearDriveBaseline();
  if (token && window.google?.accounts?.oauth2) {
    try {
      window.google.accounts.oauth2.revoke(token, () => {
        // 破棄の結果は問いません
      });
    } catch {
      // ライブラリ未読込時は認証の取り消しを省いて構いません
    }
  }
}

// ---------- フォルダとファイルの操作 ----------
interface DriveFileResource {
  id: string;
  modifiedTime: string;
}

// Driveの検索条件（q）を作ります。値に含まれる引用符はエスケープします。
export function buildListQuery(conditions: string[]): string {
  return conditions.join(" and ");
}

export function nameEquals(name: string): string {
  return `name = '${name.replace(/'/g, "\\'")}'`;
}

async function listFiles(query: string): Promise<DriveFileResource[]> {
  const params = new URLSearchParams({
    q: query,
    fields: "files(id,name,modifiedTime,createdTime)",
    orderBy: "createdTime",
  });
  const res = await driveRequest(`/drive/v3/files?${params.toString()}`);
  if (!res.ok) throw new Error(`Google Driveのファイル一覧の取得に失敗しました（${res.status}）`);
  const data = (await res.json()) as { files?: DriveFileResource[] };
  return data.files ?? [];
}

// このアプリが作った「Word Shelf」フォルダを探します。drive.fileの範囲では
// このアプリが作ったフォルダだけが見えるため、同名でも他人のものは混ざりません。
async function findFolder(): Promise<string | null> {
  const files = await listFiles(
    buildListQuery([
      nameEquals(DRIVE_FOLDER_NAME),
      "mimeType = 'application/vnd.google-apps.folder'",
      "trashed = false",
    ]),
  );
  return files[0]?.id ?? null;
}

async function ensureFolder(): Promise<string> {
  const existing = await findFolder();
  if (existing) return existing;
  const res = await driveRequest("/drive/v3/files?fields=id", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: DRIVE_FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
    }),
  });
  if (!res.ok) throw new Error(`Google Driveにフォルダを作成できませんでした（${res.status}）`);
  const data = (await res.json()) as { id: string };
  return data.id;
}

async function findFile(folderId: string, name: string): Promise<DriveBaseline | null> {
  const files = await listFiles(
    buildListQuery([nameEquals(name), `'${folderId}' in parents`, "trashed = false"]),
  );
  const file = files[0];
  return file ? { fileId: file.id, modifiedTime: file.modifiedTime } : null;
}

async function uploadFile(
  folderId: string,
  name: string,
  body: Blob,
  existing: DriveBaseline | null,
): Promise<DriveBaseline> {
  if (existing) {
    const res = await driveRequest(
      `/upload/drive/v3/files/${existing.fileId}?uploadType=media&fields=id,modifiedTime`,
      { method: "PATCH", body },
    );
    if (!res.ok) throw new Error(`Google Driveへの保存に失敗しました（${res.status}）`);
    const data = (await res.json()) as DriveFileResource;
    return { fileId: data.id, modifiedTime: data.modifiedTime };
  }
  const boundary = "word-shelf-boundary";
  const metadata = JSON.stringify({ name, parents: [folderId], mimeType: body.type || undefined });
  const multipart = new Blob(
    [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      metadata,
      `\r\n--${boundary}\r\nContent-Type: ${body.type || "application/octet-stream"}\r\n\r\n`,
      body,
      `\r\n--${boundary}--`,
    ],
    { type: `multipart/related; boundary=${boundary}` },
  );
  const res = await driveRequest("/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime", {
    method: "POST",
    body: multipart,
  });
  if (!res.ok) throw new Error(`Google Driveへの保存に失敗しました（${res.status}）`);
  const data = (await res.json()) as DriveFileResource;
  return { fileId: data.id, modifiedTime: data.modifiedTime };
}

// Drive上の正本を開きます。開いた時点の状態を競合確認の控えに残します。
export async function driveOpenMaster(): Promise<string> {
  const folderId = await findFolder();
  if (folderId === null) {
    throw new Error(
      "Google Driveに「Word Shelf」フォルダが見つかりませんでした。先にこのアプリからDriveへ保存してください。",
    );
  }
  const meta = await findFile(folderId, MASTER_FILE_NAME);
  if (meta === null) {
    throw new Error(
      "Google Driveの「Word Shelf」フォルダに正本ファイルが見つかりませんでした。先にこのアプリからDriveへ保存してください。",
    );
  }
  const res = await driveRequest(`/drive/v3/files/${meta.fileId}?alt=media`);
  if (!res.ok) throw new Error(`Google Driveからの読み込みに失敗しました（${res.status}）`);
  const text = await res.text();
  saveDriveBaseline(meta);
  return text;
}

export interface DriveSaveFile {
  name: string;
  body: Blob;
}

// 正本とIME用ファイルをDriveへ保存します。正本は保存前に競合を確認し、
// 競合していれば DriveConflictError を投げます（force のときは確認を
// 省いて上書きします）。保存できたら新しい控えを残して返します。
export async function driveSaveFiles(
  files: DriveSaveFile[],
  options: { force?: boolean } = {},
): Promise<DriveBaseline> {
  const folderId = await ensureFolder();
  const remoteMaster = await findFile(folderId, MASTER_FILE_NAME);
  if (!options.force && detectDriveConflict(loadDriveBaseline(), remoteMaster)) {
    throw new DriveConflictError(remoteMaster!.modifiedTime);
  }
  let masterMeta: DriveBaseline | null = null;
  for (const file of files) {
    const existing =
      file.name === MASTER_FILE_NAME ? remoteMaster : await findFile(folderId, file.name);
    const meta = await uploadFile(folderId, file.name, file.body, existing);
    if (file.name === MASTER_FILE_NAME) masterMeta = meta;
  }
  if (masterMeta === null) {
    throw new Error("正本ファイルが保存対象に含まれていません。");
  }
  saveDriveBaseline(masterMeta);
  return masterMeta;
}
