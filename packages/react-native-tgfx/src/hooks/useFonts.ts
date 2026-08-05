import { useEffect, useState } from 'react'
import { NitroModules } from 'react-native-nitro-modules'
import { fontStyleOf } from '../compiler/text'
import type { TextMeasurement, TgfxFonts } from '../specs/TgfxFonts.nitro'
import type { FontProps, ParagraphProps } from '../types'
import { loadSource } from './source'

let manager: TgfxFonts | null = null
function fonts(): TgfxFonts {
  manager ??= NitroModules.createHybridObject<TgfxFonts>('TgfxFonts')
  return manager
}

export type { LineMeasurement, TextMeasurement } from '../specs/TgfxFonts.nitro'

/** A `require('./Font.ttf')` asset, a URI, or raw base64 font bytes. */
export type FontSource = number | string

/**
 * Register one font face under `family`. Weight and slant come from the font's
 * own OS/2 table, so a family's regular and bold faces register identically and
 * `<Text fontWeight>` picks between them.
 *
 * Pass an empty `family` to file the face under the name inside the font.
 * Resolves to the family name it was filed under.
 *
 * Registration is process-wide and permanent: the same face registered twice
 * replaces itself rather than stacking.
 */
export function loadFont(
  source: FontSource,
  family: string = ''
): Promise<string> {
  const api = fonts()
  return loadSource(source, {
    fromFile: (path) => api.registerFromFile(path, family),
    fromBytes: (bytes) => api.registerFromBytes(bytes, family),
    fromBase64: (data) => api.registerFromBase64(data, family),
  })
}

/** Register every face of every family. Resolves once all of them are in. */
export function loadFonts(
  families: Record<string, FontSource[]>
): Promise<string[]> {
  return Promise.all(
    Object.entries(families).flatMap(([family, sources]) =>
      sources.map((source) => loadFont(source, family))
    )
  )
}

export interface FontsState {
  readonly ready: boolean
  readonly error: Error | null
}

const PENDING: FontsState = Object.freeze({ ready: false, error: null })

/**
 * Register fonts for the lifetime of a component, with their ready and error
 * state. Use this over `useFonts` when a failed load needs to be visible rather
 * than gating the text off forever.
 *
 * Faces are not unregistered on unmount: they are process-wide, cheap to keep,
 * and another canvas may still be drawing with them.
 */
export function useFontsState(
  families: Record<string, FontSource[]>
): FontsState {
  const [state, setState] = useState<FontsState>(PENDING)
  const key = JSON.stringify(families)

  useEffect(() => {
    let active = true
    setState(PENDING)
    loadFonts(families)
      .then(() => {
        if (active) {
          setState({ ready: true, error: null })
        }
      })
      .catch((e: unknown) => {
        const error = e instanceof Error ? e : new Error(String(e))
        console.warn('[tgfx] useFonts failed to load:', error)
        if (active) {
          setState({ ready: false, error })
        }
      })
    return () => {
      active = false
    }
  }, [key])

  return state
}

/**
 * Register fonts for the lifetime of a component and report when they are in.
 *
 * Renders once with `false`, then once more with `true`. Text drawn before the
 * faces land uses the platform fallback, so gate on the return value when that
 * would be visible:
 *
 * ```tsx
 * const ready = useFonts({ Playfair: [require('./Playfair-Regular.ttf')] })
 * return <Canvas>{ready && <Text fontFamily="Playfair" ... />}</Canvas>
 * ```
 *
 * A load failure leaves this `false` forever; use `useFontsState` to see it.
 */
export function useFonts(families: Record<string, FontSource[]>): boolean {
  return useFontsState(families).ready
}

/** Every family registered so far, in registration order. */
export function registeredFontFamilies(): string[] {
  return fonts().familyNames
}

/**
 * Exactly the `<Text>` props that affect layout — derived from them, not
 * re-listed, so a prop added to one cannot go missing from the other. Only
 * `fontSize` narrows: there is nothing to animate against here.
 */
export type TextStyle = Omit<FontProps, 'fontSize'> &
  ParagraphProps & { fontSize?: number }

/**
 * What `text` would occupy if `<Text>` drew it with these props — same layout,
 * same fallback chain, so a width measured here is the width drawn.
 *
 * The result is relative to the first baseline: `ascent` is negative, and the
 * box runs from `y + ascent` to `y + ascent + height`.
 */
export function measureText(
  text: string,
  style: TextStyle = {}
): TextMeasurement {
  return fonts().measureText(text, fontStyleOf(style))
}

/**
 * The same layout as SVG path data, ready for `<Path>`: text you can stroke,
 * dash, or feed to a path effect rather than only fill.
 *
 * Relative to the first baseline at (0, 0) — the coordinates `measureText`
 * reports — so translate it by the `x`/`y` you would have given `<Text>`.
 * Empty for a face with no outlines, which is what a colour emoji is.
 */
export function textPath(text: string, style: TextStyle = {}): string {
  return fonts().textPath(text, fontStyleOf(style))
}

/**
 * The glyph id per codepoint of `text` in the face `style` selects, for placing
 * them yourself with `<Glyphs>`. 0 where the face has no glyph: this is the one
 * path with no fallback, because a caller doing its own layout is the one that
 * decides what to do about a hole.
 */
export function glyphIds(text: string, style: TextStyle = {}): number[] {
  return fonts().glyphIds(text, fontStyleOf(style))
}
