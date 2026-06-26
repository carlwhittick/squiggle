export type SquiggleOptions = {
  amplitudeEm?: number;
  wavelengthBase?: number;
  wavelengthEm?: number;
  frequency?: number;
  propagationSpeed?: number;
  spatialDamping?: number;
  timeDamping?: number;
  /** Fallback stroke thickness (em) — used only when canvas measurement fails */
  thicknessEm?: number;
  /** Fallback underline offset from line mid-point (em) — used only when canvas measurement fails */
  offsetYEm?: number;
  skipInkGapEm?: number;
};

type Ripple = { originX: number; startTime: number };
type DecorationStyle = { color: string; thickness: number };
type LineBox = { x: number; width: number; lineTop: number; lineH: number };
type UnderlineLine = { x: number; y: number; width: number; mask: boolean[] };

export type SquiggleInstance = { destroy: () => void };

const TWO_PI = Math.PI * 2;
const AUTO = 'auto';
const FROM_FONT = 'from-font';

function readDecoration(el: HTMLElement, fallbackThickness: number): DecorationStyle {
  const cs = getComputedStyle(el);
  const rawColor = cs.textDecorationColor;
  const color = rawColor && rawColor !== 'rgba(0, 0, 0, 0)' ? rawColor : cs.color;
  const rawThickness = cs.textDecorationThickness;
  const thickness =
    rawThickness && rawThickness !== AUTO && rawThickness !== FROM_FONT
      ? parseFloat(rawThickness) || fallbackThickness
      : fallbackThickness;
  return { color, thickness };
}

/** Collect text line bounding boxes from the element. */
function getLineBoxes(el: HTMLElement): LineBox[] {
  const elRect = el.getBoundingClientRect();
  const lineMap = new Map<number, { x: number; right: number; lineTop: number; lineH: number }>();
  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (!(node as Text).textContent?.trim()) continue;
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (rect.width < 1) continue;
      const key = Math.round(rect.top - elRect.top);
      const x = rect.left - elRect.left;
      const right = rect.right - elRect.left;
      if (lineMap.has(key)) {
        const l = lineMap.get(key)!;
        l.x = Math.min(l.x, x);
        l.right = Math.max(l.right, right);
      } else {
        lineMap.set(key, { x, right, lineTop: rect.top - elRect.top, lineH: rect.height });
      }
    }
  }
  range.detach();
  return Array.from(lineMap.values())
    .sort((a, b) => a.lineTop - b.lineTop)
    .map(({ x, right, lineTop, lineH }) => ({ x, width: right - x, lineTop, lineH }));
}

/**
 * Measure the native underline position and thickness for the element's current
 * font by rendering the text with a magenta underline via SVG foreignObject onto
 * an offscreen canvas and pixel-scanning the result.
 *
 * Returns { yCenter, thickness } in pixels relative to the top of the line box,
 * or null if the SVG render fails.
 */
async function measureNativeUnderline(
  el: HTMLElement,
  lineH: number,
): Promise<{ yCenter: number; thickness: number } | null> {
  const cs = getComputedStyle(el);
  const text = el.textContent?.trim() || 'gjpqy';
  const w = 600;
  const h = Math.ceil(lineH) + 10;

  const oc = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(w, h)
    : (() => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; })();
  const ctx = (oc as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D;
  if (!ctx) return null;

  const html =
    `<div xmlns="http://www.w3.org/1999/xhtml" style="` +
    `font:${cs.font};` +
    `color:transparent;` +
    `text-decoration:underline;` +
    `text-decoration-color:rgb(255,0,128);` +
    `text-decoration-skip-ink:none;` +
    `white-space:nowrap;` +
    `line-height:${lineH}px;` +
    `height:${lineH}px;` +
    `overflow:visible;` +
    `margin:0;padding:0` +
    `">${text}</div>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<foreignObject x="0" y="0" width="${w}" height="${h}">${html}</foreignObject>` +
    `</svg>`;

  try {
    await new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.onload = () => { ctx.drawImage(img, 0, 0); resolve(); };
      img.onerror = () => reject(new Error('SVG render failed'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  } catch {
    return null;
  }

  const { data } = ctx.getImageData(0, 0, w, h);
  const rows: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // Magenta: high R, low G, mid-high B, opaque
      if (data[i + 3] > 50 && data[i] > 180 && data[i + 1] < 80 && data[i + 2] > 80) {
        rows.push(y);
        break;
      }
    }
  }
  if (rows.length === 0) return null;

  const minY = Math.min(...rows);
  const maxY = Math.max(...rows);
  return { yCenter: (minY + maxY) / 2, thickness: maxY - minY + 1 };
}

function renderTextOffscreen(el: HTMLElement, width: number, height: number): Uint8ClampedArray | null {
  if (width <= 0 || height <= 0) return null;
  const cs = getComputedStyle(el);
  const fontSize = parseFloat(cs.fontSize) || 16;

  const oc = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : (() => { const c = document.createElement('canvas'); c.width = width; c.height = height; return c; })();

  const octx = (oc as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D;
  if (!octx) return null;

  octx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  octx.fillStyle = '#000';
  octx.textBaseline = 'bottom';

  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const firstText = walker.nextNode() as Text | null;
  let drawY = height * 0.8;
  if (firstText?.length) {
    const range = document.createRange();
    range.setStart(firstText, 0);
    range.setEnd(firstText, 1);
    const rect = range.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    drawY = rect.bottom - elRect.top - (rect.height - fontSize) / 2;
    range.detach();
  }

  octx.fillText(el.textContent ?? '', parseFloat(cs.paddingLeft) || 0, drawY);
  return octx.getImageData(0, 0, width, height).data;
}

function buildLineMask(pixels: Uint8ClampedArray, lineY: number, gap: number, width: number, canvasH: number): boolean[] {
  const bandTop = Math.max(0, Math.floor(lineY - gap));
  const bandH = Math.min(canvasH - bandTop, Math.ceil(lineY - bandTop + gap) + 1);
  const mask = new Array<boolean>(width + 1).fill(false);
  if (bandH <= 0) return mask;

  for (let y = 0; y < bandH; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[((bandTop + y) * width + x) * 4 + 3] > 15) {
        const lo = Math.max(0, Math.floor(x - gap));
        const hi = Math.min(width, Math.ceil(x + gap));
        for (let i = lo; i <= hi; i++) mask[i] = true;
      }
    }
  }
  return mask;
}

/**
 * Attach animated canvas squiggle underlines to elements matching `selector`.
 * Underlines ripple outward from click/hover origin and dampen over time.
 *
 * Underline position and thickness are measured from the browser's own font
 * rendering via an offscreen canvas, and automatically update when the font
 * changes (size, weight, family, etc.).
 *
 * @example
 * const instance = squiggleUnderline('a, .link');
 * // later:
 * instance.destroy();
 */
export function squiggleUnderline(selector: string, options: SquiggleOptions = {}): SquiggleInstance {
  const {
    amplitudeEm = 0.2,
    wavelengthBase = 16,
    wavelengthEm = 0.5,
    frequency = 4,
    propagationSpeed = 300,
    spatialDamping = 0.012,
    timeDamping = 2.5,
    thicknessEm = 0.075,
    offsetYEm = -0.05,
    skipInkGapEm = 0.1,
  } = options;

  const omega = TWO_PI * frequency;
  const elements = document.querySelectorAll<HTMLElement>(selector);
  const cleanups: (() => void)[] = [];

  elements.forEach((el) => {
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.style.setProperty('text-decoration', 'none', 'important');

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;overflow:visible;';
    el.appendChild(canvas);

    const ctx = canvas.getContext('2d')!;
    const ripples: Ripple[] = [];
    let rafId: number | null = null;
    let amplitude = 3;
    let k = TWO_PI / 24;
    let fallbackThickness = 1.5;
    let capPad = 2;
    let lines: UnderlineLine[] = [];
    let ready = false;
    let resizeSeq = 0;

    async function resize() {
      const seq = ++resizeSeq;
      ready = false;

      const cs = getComputedStyle(el);
      const fontSize = parseFloat(cs.fontSize) || 16;
      amplitude = amplitudeEm * fontSize;
      k = TWO_PI / (wavelengthBase + wavelengthEm * fontSize);
      const skipInkGap = Math.max(2, skipInkGapEm * fontSize);

      const boxes = getLineBoxes(el);

      // Measure underline position and thickness from the browser's own rendering.
      // Falls back to formula-based values if the SVG render is unavailable.
      let underlineYInBox: number;
      if (boxes.length > 0) {
        const measured = await measureNativeUnderline(el, boxes[0].lineH);
        if (seq !== resizeSeq) return; // superseded by a later resize
        if (measured) {
          underlineYInBox = measured.yCenter;
          fallbackThickness = Math.max(1, measured.thickness);
        } else {
          underlineYInBox = (boxes[0].lineH + fontSize) / 2 + offsetYEm * fontSize;
          fallbackThickness = Math.max(1, thicknessEm * fontSize);
        }
      } else {
        underlineYInBox = fontSize * (0.6 + offsetYEm);
        fallbackThickness = Math.max(1, thicknessEm * fontSize);
      }

      capPad = Math.ceil(fallbackThickness / 2) + 1;

      const maxRight = boxes.reduce((m, b) => Math.max(m, b.x + b.width), 0);
      const maxY = boxes.reduce((m, b) => Math.max(m, b.lineTop + underlineYInBox), 0);
      const w = Math.ceil(maxRight) || el.getBoundingClientRect().width;
      const h = Math.ceil(maxY + amplitude + fallbackThickness + 2);

      canvas.width = w + capPad * 2;
      canvas.height = h;
      canvas.style.left = `-${capPad}px`;

      const elH = el.offsetHeight;
      const pixels = renderTextOffscreen(el, w, elH);

      lines = boxes.map(({ x, lineTop, width }) => {
        const y = lineTop + underlineYInBox;
        return {
          x, width, y,
          mask: pixels
            ? buildLineMask(pixels, y, skipInkGap, w, elH)
            : new Array<boolean>(w + 1).fill(false),
        };
      });

      ready = true;
    }

    function getDisplacement(x: number, ripple: Ripple, now: number): number {
      const elapsed = (now - ripple.startTime) / 1000;
      const dist = Math.abs(x - ripple.originX);
      if (dist > elapsed * propagationSpeed) return 0;
      const smoothDist = Math.sqrt(dist * dist + (1 / k) * (1 / k));
      return (
        amplitude *
        Math.sin(k * smoothDist - omega * elapsed) *
        Math.exp(-dist * spatialDamping) *
        Math.exp(-elapsed * timeDamping)
      );
    }

    function applyStroke(deco: DecorationStyle) {
      ctx.strokeStyle = deco.color;
      ctx.lineWidth = deco.thickness;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
    }

    function drawLines(getDy: (x: number) => number): Array<[number, number]> {
      const caps: Array<[number, number]> = [];
      for (const line of lines) {
        let inPath = false;
        let lastCx = 0, lastY = 0;
        for (let lx = 0; lx <= line.width; lx++) {
          const ex = line.x + lx;
          const cx = ex + capPad;
          const masked = line.mask[Math.round(ex)];
          if (masked) {
            if (inPath) { caps.push([lastCx, lastY]); inPath = false; }
            continue;
          }
          const y = line.y + getDy(ex);
          if (!inPath) { caps.push([cx, y]); ctx.moveTo(cx, y); inPath = true; }
          else ctx.lineTo(cx, y);
          lastCx = cx; lastY = y;
        }
        if (inPath) caps.push([lastCx, lastY]);
      }
      return caps;
    }

    function drawCaps(caps: Array<[number, number]>, r: number, color: string) {
      ctx.beginPath();
      ctx.fillStyle = color;
      for (const [x, y] of caps) {
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, TWO_PI);
      }
      ctx.fill();
    }

    function render(getDy: (x: number) => number) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const deco = readDecoration(el, fallbackThickness);
      ctx.beginPath();
      applyStroke(deco);
      const caps = drawLines(getDy);
      ctx.stroke();
      drawCaps(caps, deco.thickness / 2, deco.color);
    }

    function draw(now: number) {
      render((x) => { let dy = 0; for (const r of ripples) dy += getDisplacement(x, r, now); return dy; });

      const nowSecs = now / 1000;
      for (let i = ripples.length - 1; i >= 0; i--) {
        if (nowSecs - ripples[i].startTime / 1000 > 4) ripples.splice(i, 1);
      }
      if (ripples.length > 0) { rafId = requestAnimationFrame(draw); }
      else { rafId = null; render(() => 0); }
    }

    function drawFlat() { render(() => 0); }

    function onMouseEnter(e: MouseEvent) {
      if (!ready) return;
      ripples.push({ originX: e.clientX - el.getBoundingClientRect().left + capPad, startTime: performance.now() });
      if (rafId === null) rafId = requestAnimationFrame(draw);
    }

    function onActivate(e: MouseEvent | FocusEvent) {
      if (!ready) return;
      const originX = e instanceof MouseEvent
        ? e.clientX - el.getBoundingClientRect().left + capPad
        : el.offsetWidth / 2 + capPad;
      ripples.push({ originX, startTime: performance.now() });
      if (rafId === null) rafId = requestAnimationFrame(draw);
    }

    resize().then(drawFlat);

    const onResize = () => resize().then(drawFlat);
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement);
    window.addEventListener('resize', onResize);

    // Re-measure when inline style or class changes (catches font-size, font-weight, font-family etc.)
    const mo = new MutationObserver(onResize);
    mo.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });

    el.addEventListener('mouseenter', onMouseEnter);
    el.addEventListener('click', onActivate);
    el.addEventListener('focus', onActivate);

    cleanups.push(() => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', onResize);
      el.removeEventListener('mouseenter', onMouseEnter);
      el.removeEventListener('click', onActivate);
      el.removeEventListener('focus', onActivate);
      canvas.remove();
    });
  });

  return { destroy: () => cleanups.forEach((fn) => fn()) };
}
