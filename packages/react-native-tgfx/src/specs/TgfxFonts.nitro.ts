import type { HybridObject } from 'react-native-nitro-modules'

/**
 * A resolved text style, exactly as the native layout wants it. Everything is
 * required and pre-defaulted so the generated struct stays a flat record of
 * primitives; `measureText` in `hooks/useFonts.ts` fills it from the friendlier
 * `<Text>` props.
 */
export interface TextLayoutStyle {
  fontSize: number
  fontFamily: string
  /** CSS weight, 100-1000. */
  fontWeight: number
  italic: boolean
  /** Force synthetic emphasis, on top of whatever the family match already synthesises. */
  fauxBold: boolean
  fauxItalic: boolean
  letterSpacing: number
  /** Wrap width in px; 0 means no wrapping. */
  width: number
  /** 0 left, 1 center, 2 right. */
  align: number
  /** Baseline-to-baseline px; 0 means the font's own spacing. */
  lineHeight: number
  /** 0 means unlimited. */
  maxLines: number
  ellipsis: string
}

/** One line of a laid-out paragraph, in the paragraph's own coordinates. */
export interface LineMeasurement {
  width: number
  /** Where the line starts once alignment has placed it. */
  x: number
  /** Distance below the first baseline. */
  baseline: number
  /** Negative, as in Skia: the extent above this line's baseline. */
  ascent: number
  descent: number
  /** UTF-8 byte offsets of the line's first and last glyph in the string. */
  startIndex: number
  endIndex: number
}

/** Where a point in paragraph coordinates falls, as an insertion point. */
export interface GlyphPosition {
  /**
   * The insertion point, as a UTF-8 byte offset into the string. Always where
   * a caret goes - never a glyph index to advance past.
   */
  index: number
  /**
   * Which half produced it: true when the point fell on the leading half of the
   * glyph that starts at `index`, false when it fell on the trailing half of
   * the glyph that ends there, or past the end of the line. That is the
   * affinity a caret needs at a wrap, where one offset has two positions.
   */
  leading: boolean
  /** Which line the point resolved to, after clamping. */
  line: number
}

/** One run of a byte range on a single line, in paragraph coordinates. */
export interface TextBox {
  x: number
  y: number
  width: number
  height: number
  line: number
  /**
   * The byte range of the glyphs this box covers: the requested range clipped
   * to this line and rounded out to whole codepoints. `endIndex` is exclusive,
   * unlike `LineMeasurement.endIndex`, which names its last glyph.
   */
  startIndex: number
  endIndex: number
}

/** What a laid-out string occupies, with its first baseline at y = 0. */
export interface TextMeasurement {
  width: number
  height: number
  /** Negative, as in Skia: the extent above the baseline. */
  ascent: number
  descent: number
  lineCount: number
  /** One entry per line, in order. */
  lines: LineMeasurement[]
}

/**
 * The font manager: registers typefaces from app assets and measures text
 * against exactly the layout `<Text>` will draw.
 */
export interface TgfxFonts extends HybridObject<{
  ios: 'c++'
  android: 'c++'
}> {
  /**
   * Register a font file. `family` overrides the name inside the font; pass an
   * empty string to file it under its own family name. Weight and slant are read
   * from the font's OS/2 table, so a family's regular and bold faces register
   * the same way and `fontWeight` picks between them.
   *
   * Resolves to the family name it was filed under.
   */
  registerFromFile(path: string, family: string): Promise<string>

  /** The same, from font bytes - zero-copy across the Nitro boundary. */
  registerFromBytes(bytes: ArrayBuffer, family: string): Promise<string>

  /** The same, from base64-encoded font bytes. */
  registerFromBase64(data: string, family: string): Promise<string>

  /** Every family registered so far, in registration order. */
  readonly familyNames: string[]

  /**
   * Lay `text` out and report what it occupies. Runs the same layout the
   * renderer does, so a width measured here is the width that gets drawn.
   */
  measureText(text: string, style: TextLayoutStyle): TextMeasurement

  /**
   * The same layout as an outline, in SVG path data - the string `<Path>` takes.
   * Relative to the first baseline at (0, 0), exactly as `measureText` reports.
   *
   * Empty when the face has no outlines to give: a colour emoji is a bitmap.
   */
  textPath(text: string, style: TextLayoutStyle): string

  /**
   * The insertion point nearest `x`, `y` in the same coordinates `measureText`
   * reports - first baseline at y = 0. The y picks a line and is clamped to the
   * paragraph, so a point above or below one still resolves.
   */
  glyphPositionAtCoordinate(
    text: string,
    style: TextLayoutStyle,
    x: number,
    y: number
  ): GlyphPosition

  /**
   * The boxes a UTF-8 byte range occupies, one per line it crosses. A selection
   * highlight draws these; a one-glyph range reports that glyph's bounds.
   */
  rectsForRange(
    text: string,
    style: TextLayoutStyle,
    start: number,
    end: number
  ): TextBox[]

  /**
   * The glyph id per codepoint of `text` in the face `style` selects, for a
   * caller placing glyphs itself with `<Glyphs>`. 0 means the face has no glyph
   * for that codepoint - there is no fallback here, by design: `<Glyphs>` is the
   * escape hatch for callers doing their own layout.
   */
  glyphIds(text: string, style: TextLayoutStyle): number[]
}
