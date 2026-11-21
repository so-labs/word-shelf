// 仮想スクロールの純粋計算です。一覧のうち画面の近くにある分だけを
// 描画するために、各カードの上端位置と、表示すべき範囲を求めます。
// 高さは実測値を優先し、まだ測れていないカードは推定値で計算します。

// 各カードの上端位置（累積）を返します。戻り値の長さは heights.length + 1 で、
// 最後の要素が全体の高さです。
export function buildOffsets(heights: readonly number[]): number[] {
  const offsets = new Array<number>(heights.length + 1);
  let total = 0;
  offsets[0] = 0;
  for (let i = 0; i < heights.length; i++) {
    total += heights[i]!;
    offsets[i + 1] = total;
  }
  return offsets;
}

// [viewStart, viewEnd) と重なるカードの範囲 [start, end) を返します。
// offsets は buildOffsets の戻り値です。範囲外は端に寄せます。
export function findVisibleRange(
  offsets: readonly number[],
  viewStart: number,
  viewEnd: number,
): { start: number; end: number } {
  const count = offsets.length - 1;
  if (count <= 0) return { start: 0, end: 0 };
  const total = offsets[count]!;
  const from = Math.min(Math.max(viewStart, 0), total);
  const to = Math.min(Math.max(viewEnd, from), total);

  // 下端が from より下にある最初のカードが開始位置です。
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid + 1]! <= from) lo = mid + 1;
    else hi = mid;
  }
  const start = lo;

  // 上端が to 以上になる最初のカードが終了位置（排他）です。
  lo = start;
  hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid]! < to) lo = mid + 1;
    else hi = mid;
  }
  return { start, end: lo };
}
