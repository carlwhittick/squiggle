export interface UnderlineAnalysis {
  yCenter: number;
  thickness: number;
  /** [startX, endX] ranges with no underline pixels */
  gaps: Array<[number, number]>;
  hasUnderline: boolean;
}

/**
 * Scan RGBA pixel data for a coloured underline band.
 *
 * Searches rows from `startY` downward. Returns the first contiguous band of
 * rows that contain pixels matching `color` within `tolerance`, then reports
 * gap columns within that band.
 */
export function analyzeUnderline(
  data: Uint8ClampedArray | number[],
  width: number,
  height: number,
  color: { r: number; g: number; b: number },
  startY = 0,
  tolerance = 40,
  /** Scan upward from the bottom — use for native element screenshots where
   *  padding-bottom guarantees empty rows after the underline. */
  fromBottom = false,
): UnderlineAnalysis {
  const coloredRows: number[] = [];
  // An underline row must span at least this many columns. Thin strokes with
  // anti-aliasing may only produce 2–4 pixels per row.
  const MIN_COLS = 2;

  const ys = fromBottom
    ? Array.from({ length: height - startY }, (_, i) => height - 1 - i)
    : Array.from({ length: height - startY }, (_, i) => startY + i);

  for (const y of ys) {
    let count = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (
        data[i + 3] > 50 &&
        Math.abs(data[i]     - color.r) < tolerance &&
        Math.abs(data[i + 1] - color.g) < tolerance &&
        Math.abs(data[i + 2] - color.b) < tolerance
      ) {
        count++;
      }
    }
    if (count >= MIN_COLS) coloredRows.push(y);
  }

  if (coloredRows.length === 0) {
    return { yCenter: 0, thickness: 0, gaps: [], hasUnderline: false };
  }

  // Keep the first contiguous band *in traversal order* — when scanning from
  // the bottom this gives the underline band, not the text body above it.
  const bandRows: number[] = [coloredRows[0]];
  for (let i = 1; i < coloredRows.length; i++) {
    if (Math.abs(coloredRows[i] - coloredRows[i - 1]) > 3) break;
    bandRows.push(coloredRows[i]);
  }
  bandRows.sort((a, b) => a - b);

  const minY = bandRows[0];
  const maxY = bandRows[bandRows.length - 1];

  // Column presence within the band
  const colHasColor = new Array<boolean>(width).fill(false);
  for (let y = minY; y <= maxY; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (
        data[i + 3] > 50 &&
        Math.abs(data[i]     - color.r) < tolerance &&
        Math.abs(data[i + 1] - color.g) < tolerance &&
        Math.abs(data[i + 2] - color.b) < tolerance
      ) {
        colHasColor[x] = true;
      }
    }
  }

  const gaps: Array<[number, number]> = [];
  let inGap = false;
  let gapStart = 0;
  for (let x = 0; x < width; x++) {
    if (!colHasColor[x] && !inGap) { inGap = true; gapStart = x; }
    if (colHasColor[x] && inGap)   { inGap = false; gaps.push([gapStart, x - 1]); }
  }
  if (inGap) gaps.push([gapStart, width - 1]);

  return {
    yCenter: (minY + maxY) / 2,
    thickness: maxY - minY + 1,
    gaps,
    hasUnderline: true,
  };
}

export function parseCssColor(css: string): { r: number; g: number; b: number } {
  const m = css.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) throw new Error(`Cannot parse color: ${css}`);
  return { r: +m[1], g: +m[2], b: +m[3] };
}

/**
 * Gap centres from two analyses overlap within `tol` px.
 * Returns fraction of native gaps matched.
 */
export function gapOverlap(
  native: Array<[number, number]>,
  squiggle: Array<[number, number]>,
  tol = 6,
): number {
  if (native.length === 0) return 1;
  let matched = 0;
  for (const [ns, ne] of native) {
    const nc = (ns + ne) / 2;
    if (squiggle.some(([ss, se]) => Math.abs((ss + se) / 2 - nc) <= tol)) matched++;
  }
  return matched / native.length;
}
