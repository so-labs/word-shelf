// 最小限のZIP読み込みです。Gboardの書き出し（dictionary.txt が1つだけ
// 入ったZIP）のような、単一ファイルの取り出しだけを想定しています。
// 中央ディレクトリから対象を探し、無圧縮（stored）または deflate の
// エントリを読みます。暗号化や分割ZIPには対応しません。

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)
  ) >>> 0;
}

// 末尾の中央ディレクトリ終端レコード（EOCD）を探して、中央ディレクトリの
// 開始位置と件数を返します。
function findCentralDirectory(bytes: Uint8Array): { offset: number; count: number } {
  const EOCD_SIGNATURE = 0x06054b50;
  const minSize = 22;
  for (let i = bytes.length - minSize; i >= 0; i--) {
    if (readUint32LE(bytes, i) === EOCD_SIGNATURE) {
      return {
        count: readUint16LE(bytes, i + 10),
        offset: readUint32LE(bytes, i + 16),
      };
    }
  }
  throw new Error("ZIPファイルの中央ディレクトリが見つかりません");
}

function readCentralDirectory(bytes: Uint8Array): ZipEntry[] {
  const { offset, count } = findCentralDirectory(bytes);
  const entries: ZipEntry[] = [];
  const decoder = new TextDecoder("utf-8");
  let pos = offset;
  for (let i = 0; i < count; i++) {
    if (readUint32LE(bytes, pos) !== 0x02014b50) break;
    const nameLength = readUint16LE(bytes, pos + 28);
    const extraLength = readUint16LE(bytes, pos + 30);
    const commentLength = readUint16LE(bytes, pos + 32);
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength));
    entries.push({
      name,
      method: readUint16LE(bytes, pos + 10),
      compressedSize: readUint32LE(bytes, pos + 20),
      localHeaderOffset: readUint32LE(bytes, pos + 42),
    });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream("deflate-raw");
  const source = new Blob([new Uint8Array(data)]).stream().pipeThrough(stream);
  const buffer = await new Response(source).arrayBuffer();
  return new Uint8Array(buffer);
}

// ZIPからファイルを1つ取り出します。entryName を指定した場合はその名前の
// エントリを、省略した場合は最初のエントリを返します。
export async function extractZipEntry(
  bytes: Uint8Array,
  entryName?: string,
): Promise<{ name: string; data: Uint8Array }> {
  const entries = readCentralDirectory(bytes);
  const entry =
    (entryName !== undefined
      ? entries.find((e) => e.name.toLowerCase() === entryName.toLowerCase())
      : undefined) ?? entries[0];
  if (!entry) throw new Error("ZIPファイルにファイルが含まれていません");
  const pos = entry.localHeaderOffset;
  if (readUint32LE(bytes, pos) !== 0x04034b50) {
    throw new Error("ZIPファイルのローカルヘッダーが想定と異なります");
  }
  const nameLength = readUint16LE(bytes, pos + 26);
  const extraLength = readUint16LE(bytes, pos + 28);
  const dataStart = pos + 30 + nameLength + extraLength;
  const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) {
    return { name: entry.name, data: new Uint8Array(compressed) };
  }
  if (entry.method === 8) {
    return { name: entry.name, data: await inflateRaw(compressed) };
  }
  throw new Error(`対応していないZIPの圧縮形式です: ${entry.method}`);
}
