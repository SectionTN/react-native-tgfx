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

/** What a laid-out string occupies, with its first baseline at y = 0. */
export interface TextMeasurement {
  width: number
  height: number
  /** Negative, as in Skia: the extent above the baseline. */
  ascent: number
  descent: number
  lineCount: number
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

  /** The same, from font bytes — zero-copy across the Nitro boundary. */
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
}
