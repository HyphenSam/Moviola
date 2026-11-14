import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Checks the colour pairs DESIGN.md names against WCAG AA, in both themes, straight from
// src/index.css: 4.5:1 for text, 3:1 for UI parts such as outlines and focus rings.

const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')

type Oklch = [number, number, number]

function tokens(block: string): Record<string, Oklch> {
  const out: Record<string, Oklch> = {}
  for (const m of block.matchAll(/--color-([\w-]+):\s*oklch\(([^)/]+)\)/g)) {
    out[m[1]] = m[2].trim().split(/\s+/).map(Number) as Oklch
  }
  return out
}

const light = tokens(css.match(/@theme\s*{([^}]*)}/)![1])
const darkBlock = css.match(/@media \(prefers-color-scheme: dark\)\s*{\s*:root\s*{([^}]*)}/)
const dark = { ...light, ...tokens(darkBlock![1]) }

/** OKLCH to linear sRGB (Björn Ottosson's matrices), clipped to the gamut. */
function linearSrgb([l, c, h]: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180)
  const b = c * Math.sin((h * Math.PI) / 180)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const rgb: [number, number, number] = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
  return rgb.map((v) => Math.min(1, Math.max(0, v))) as [number, number, number]
}

/** WCAG relative luminance takes linear channels, so no gamma step is needed. */
const luminance = (colour: Oklch) => {
  const [r, g, b] = linearSrgb(colour)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: Oklch, b: Oklch) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const TEXT = 4.5
const UI = 3

// [foreground, background, minimum]
const PAIRS: [string, string, number][] = [
  ['ink', 'panel', TEXT],
  ['ink', 'canvas', TEXT],
  ['ink-soft', 'panel', TEXT],
  ['ink-soft', 'canvas', TEXT],
  ['ink', 'sunken', TEXT], // selected tool, segmented option
  ['ink-soft', 'sunken', TEXT],
  ['ink', 'accent-soft', TEXT], // text selection
  ['accent-text', 'accent-soft', TEXT], // drop overlay
  ['accent-ink', 'accent', TEXT], // primary button
  ['accent-ink', 'accent-hover', TEXT],
  ['accent-text', 'panel', TEXT], // links
  ['accent-text', 'canvas', TEXT],
  ['accent', 'panel', UI], // switches, progress, trim handles
  ['focus', 'panel', UI],
  ['focus', 'canvas', UI],
  ['ok', 'panel', TEXT], // the Lossless badge, finished exports
  ['danger', 'panel', TEXT],
  ['stage-ink', 'stage', TEXT], // transport and labels on the dark stage
  ['stage-ink-soft', 'stage', TEXT],
  ['stage-line', 'stage', UI], // the empty stage's dashed drop target
  ['focus', 'stage', UI], // focus rings on the transport and timeline
  ['ink', 'danger-soft', TEXT], // the "can't open" banner
]

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme', (_name, theme) => {
  it.each(PAIRS)('%s on %s meets %d:1', (fg, bg, min) => {
    expect(theme[fg], `--color-${fg}`).toBeDefined()
    expect(theme[bg], `--color-${bg}`).toBeDefined()
    expect(contrast(theme[fg], theme[bg])).toBeGreaterThanOrEqual(min)
  })

  it('keeps the stage near-black', () => {
    expect(theme.stage[0]).toBeLessThanOrEqual(0.18)
  })
})

it('stops animations rather than speeding them up when motion is reduced', () => {
  // A pulse squeezed into 0.01 ms but still repeating forever flickers; one run ends it.
  const reduced = css.match(/@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*?)\n  }/)![1]
  expect(reduced).toMatch(/animation-iteration-count:\s*1 !important/)
  expect(reduced).toMatch(/scroll-behavior:\s*auto !important/)
})

it('converts OKLCH white and black to the ends of sRGB', () => {
  expect(contrast([1, 0, 0], [0, 0, 0])).toBeCloseTo(21, 1)
})
