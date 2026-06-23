# @carlwhittick/squiggle

Canvas-drawn animated squiggle underlines for links and text. Ripples propagate outward from the hover/click origin and dampen over time. Skips ink around glyphs like native `text-decoration`.

## Install

```bash
npm install @carlwhittick/squiggle
```

## Usage

```ts
import { squiggleUnderline } from '@carlwhittick/squiggle';

const instance = squiggleUnderline('a, .link');

// Clean up (e.g. on SPA route change)
instance.destroy();
```

## Options

```ts
squiggleUnderline(selector, options?)
```

| Option | Type | Default | Description |
|---|---|---|---|
| `amplitudeEm` | `number` | `0.2` | Wave half-amplitude as em multiplier |
| `wavelengthBase` | `number` | `16` | Base wavelength in px |
| `wavelengthEm` | `number` | `0.5` | Wavelength em contribution |
| `frequency` | `number` | `4` | Oscillation frequency (Hz) |
| `propagationSpeed` | `number` | `300` | Ripple travel speed (px/s) |
| `spatialDamping` | `number` | `0.012` | Amplitude decay with distance |
| `timeDamping` | `number` | `2.5` | Amplitude decay over time |
| `thicknessEm` | `number` | `0.075` | Stroke thickness as em multiplier |
| `offsetYEm` | `number` | `-0.05` | Vertical offset from text baseline as em multiplier |
| `skipInkGapEm` | `number` | `0.1` | Gap around glyphs as em multiplier |

## How it works

For each matching element:

1. CSS `text-decoration` is suppressed and replaced with an absolutely-positioned `<canvas>`.
2. Text is rendered offscreen to build a pixel mask; the canvas line skips columns where glyph pixels are detected (skip-ink).
3. On `mouseenter` / `click` / `focus`, a ripple origin is recorded. Each animation frame sums wave displacement from all active ripples using a damped travelling-wave equation.
4. A `ResizeObserver` keeps the canvas in sync with element layout changes.

## Returns

```ts
{ destroy: () => void }
```

Call `destroy()` to cancel animation frames, remove canvases, and unbind all listeners.

## License

MIT
