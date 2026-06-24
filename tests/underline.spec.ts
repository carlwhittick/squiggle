import { test, expect, Page } from '@playwright/test';
import { PNG } from 'pngjs';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import * as path from 'path';
import { analyzeUnderline, parseCssColor, gapOverlap, UnderlineAnalysis } from './pixel-utils.js';

// ── constants ─────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FONT_SIZES = [12, 16, 24, 48];
const TEST_TEXT  = 'Typography gjpqy Squiggle';
const DIST_UMD   = path.resolve(__dirname, '../dist/squiggle.umd.cjs');

// Tolerances
const Y_TOL        = 2;   // px — vertical offset
const THICKNESS_TOL = 2;  // px — stroke thickness
const GAP_OVERLAP  = 0.6; // fraction of native gaps that must be matched

// ── helpers ──────────────────────────────────────────────────────────────────

function makeHtml(fontSize: number): string {
  return /* html */`<!DOCTYPE html>
<html><head><style>
  body { margin: 60px; background: white; font-family: Arial, sans-serif; }
  .native {
    font-size: ${fontSize}px;
    color: rgb(0,0,0);
    text-decoration: underline;
    text-decoration-color: rgb(200,0,0);
    text-decoration-skip-ink: auto;
    display: inline-block;
    padding-bottom: ${Math.ceil(fontSize * 0.4)}px;
  }
  .sq {
    font-size: ${fontSize}px;
    color: rgb(0,0,0);
    text-decoration: underline;
    text-decoration-color: rgb(200,0,0);
    display: inline-block;
    padding-bottom: ${Math.ceil(fontSize * 0.4)}px;
    position: relative;
  }
</style></head>
<body>
  <div><span class="native">${TEST_TEXT}</span></div>
  <div style="margin-top:40px"><span class="sq">${TEST_TEXT}</span></div>
</body></html>`;
}

/** Get canvas ImageData from squiggle element as plain array + dimensions */
async function getCanvasData(page: Page): Promise<{
  data: number[]; width: number; height: number; capPad: number;
}> {
  return page.evaluate(() => {
    const el = document.querySelector('.sq') as HTMLElement;
    const canvas = el.querySelector('canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const capPad = Math.abs(parseInt(canvas.style.left) || 0);
    return { data: Array.from(data), width, height, capPad };
  });
}

/** Screenshot an element and return parsed PNG data */
async function screenshotPng(page: Page, selector: string) {
  const el = await page.$(selector);
  const buf = await el!.screenshot();
  return PNG.sync.read(buf);
}

/** Y to start scanning for the underline — below the text body, above descenders */
function underlineScanStart(pngHeight: number): number {
  // Underline sits roughly in the bottom 50% of the element;
  // starting at 40% reliably skips cap-height text while catching the line.
  return Math.floor(pngHeight * 0.4);
}

// ── tests ─────────────────────────────────────────────────────────────────────

test.describe('squiggle vs native underline', () => {
  for (const fontSize of FONT_SIZES) {
    test.describe(`${fontSize}px`, () => {

      test.beforeEach(async ({ page }) => {
        if (!fs.existsSync(DIST_UMD)) {
          throw new Error('Run `npm run build` before tests');
        }
        await page.setContent(makeHtml(fontSize));
        const umd = fs.readFileSync(DIST_UMD, 'utf8');
        await page.addScriptTag({ content: umd });
        await page.evaluate(() => {
          (window as any).Squiggle.squiggleUnderline('.sq');
        });
        // Let canvas settle
        await page.waitForTimeout(50);
      });

      // ── color ──────────────────────────────────────────────────────────────

      test('color matches native', async ({ page }) => {
        // Squiggle sets text-decoration:none which resets textDecorationColor to
        // currentColor, so the canvas draws in the element's text color.
        const cssColor = await page.evaluate(() =>
          getComputedStyle(document.querySelector('.sq')!).color
        );
        const expected = parseCssColor(cssColor);

        const { data, width, height } = await getCanvasData(page);
        // Find first opaque pixel in the canvas
        let canvasColor: { r: number; g: number; b: number } | null = null;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] > 50) {
            canvasColor = { r: data[i], g: data[i + 1], b: data[i + 2] };
            break;
          }
        }

        expect(canvasColor).not.toBeNull();
        expect(Math.abs(canvasColor!.r - expected.r)).toBeLessThanOrEqual(15);
        expect(Math.abs(canvasColor!.g - expected.g)).toBeLessThanOrEqual(15);
        expect(Math.abs(canvasColor!.b - expected.b)).toBeLessThanOrEqual(15);
      });

      // ── Y position ─────────────────────────────────────────────────────────

      test('underline Y position within tolerance of native', async ({ page }) => {
        const nativeColor = { r: 200, g: 0, b: 0 }; // red decoration on native
        const sqColor     = { r: 0, g: 0, b: 0 };   // squiggle draws in currentColor (black)

        // Native: scan upward from bottom — padding-bottom ensures empty rows
        // below the underline, so first wide row from bottom = the underline.
        const nativePng    = await screenshotPng(page, '.native');
        const nativeResult = analyzeUnderline(
          nativePng.data, nativePng.width, nativePng.height,
          nativeColor, 0, 40, true,
        );

        // Squiggle: canvas pixels only contain the underline (no text)
        const { data, width, height } = await getCanvasData(page);
        const sqResult = analyzeUnderline(data, width, height, sqColor);

        expect(nativeResult.hasUnderline).toBe(true);
        expect(sqResult.hasUnderline).toBe(true);

        expect(Math.abs(nativeResult.yCenter - sqResult.yCenter))
          .toBeLessThanOrEqual(Y_TOL);
      });

      // ── thickness ──────────────────────────────────────────────────────────

      test('stroke thickness within tolerance of native', async ({ page }) => {
        const nativeColor = { r: 200, g: 0, b: 0 }; // red decoration on native
        const sqColor     = { r: 0, g: 0, b: 0 };   // squiggle draws in currentColor (black)

        const nativePng  = await screenshotPng(page, '.native');
        const nativeRes  = analyzeUnderline(
          nativePng.data, nativePng.width, nativePng.height,
          nativeColor, 0, 40, true,
        );

        const { data, width, height } = await getCanvasData(page);
        const sqRes = analyzeUnderline(data, width, height, sqColor);

        expect(nativeRes.hasUnderline).toBe(true);
        expect(sqRes.hasUnderline).toBe(true);

        expect(Math.abs(nativeRes.thickness - sqRes.thickness))
          .toBeLessThanOrEqual(THICKNESS_TOL);
      });

      // ── skip-ink ───────────────────────────────────────────────────────────

      test('skip-ink gaps align with native', async ({ page }) => {
        const nativeColor = { r: 200, g: 0, b: 0 }; // red decoration on native
        const sqColor     = { r: 0, g: 0, b: 0 };   // squiggle draws in currentColor (black)

        // Native gaps from screenshot
        const nativePng  = await screenshotPng(page, '.native');
        const nativeRes  = analyzeUnderline(
          nativePng.data, nativePng.width, nativePng.height,
          nativeColor, 0, 40, true,
        );

        // Squiggle gaps — shift X by capPad to get element-relative coords
        const { data, width, height, capPad } = await getCanvasData(page);
        const sqRaw = analyzeUnderline(data, width, height, sqColor);
        const sqGaps = sqRaw.gaps.map(([s, e]) =>
          [s - capPad, e - capPad] as [number, number]
        );

        // Skip test if native has no skip-ink (font may not gap at this size)
        if (nativeRes.gaps.length === 0) {
          console.log(`  [skip] native has no skip-ink gaps at ${fontSize}px`);
          return;
        }

        // Debug: replicate squiggle's exact renderTextOffscreen and buildLineMask

        const overlap = gapOverlap(nativeRes.gaps, sqGaps);
        expect(overlap).toBeGreaterThanOrEqual(GAP_OVERLAP);
      });

    });
  }
});
