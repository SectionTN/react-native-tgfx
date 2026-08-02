import { useEffect, useState } from 'react'
import { Image as RNImage } from 'react-native'
import { bytesToBase64 } from './base64'

export interface ImageState {
  /** Base64 bytes, or `null` while loading and after a failure. */
  readonly data: string | null
  /** Why the current source failed, or `null`. */
  readonly error: Error | null
  /** True from the moment a source starts loading until it settles. */
  readonly loading: boolean
}

// Handed straight to the caller on first render, so a mutation would leak into
// every component mounted after it. Frozen rather than rebuilt: the shared
// identity is what lets React bail out of the redundant initial re-render.
const PENDING: ImageState = Object.freeze({
  data: null,
  error: null,
  loading: true,
})

/**
 * Load an image source into base64 bytes, with its loading and error state.
 *
 * Accepts a `require('./pic.png')` asset, an `http(s)://`, `file://`, `data:` or
 * `asset:`/`content:` URI, or a raw base64 string (returned as-is).
 *
 * `data` is cleared the moment `source` changes, so a slow or failing load can
 * never leave the previous image on screen.
 */
export function useImageState(source: number | string): ImageState {
  const [state, setState] = useState<ImageState>(PENDING)

  useEffect(() => {
    let active = true
    // A stale image under a new source is worse than an empty one.
    setState(PENDING)

    const settle = (next: ImageState) => {
      if (active) {
        setState(next)
      }
    }

    async function load(): Promise<void> {
      let uri: string | null = null
      if (typeof source === 'number') {
        const resolved = RNImage.resolveAssetSource(source)
        uri = resolved?.uri ?? null
      } else if (/^(https?:|file:|data:|content:|asset:)/.test(source)) {
        uri = source
      } else {
        // Already a base64 payload.
        settle({ data: source, error: null, loading: false })
        return
      }
      if (uri == null) {
        throw new Error(`could not resolve asset source: ${String(source)}`)
      }
      if (uri.startsWith('data:')) {
        const comma = uri.indexOf(',')
        settle({
          data: comma >= 0 ? uri.slice(comma + 1) : uri,
          error: null,
          loading: false,
        })
        return
      }
      const res = await fetch(uri)
      // A 404 body decodes to garbage rather than failing, so check first.
      if (!res.ok) {
        throw new Error(`${uri} returned HTTP ${res.status}`)
      }
      const buf = await res.arrayBuffer()
      settle({
        data: bytesToBase64(new Uint8Array(buf)),
        error: null,
        loading: false,
      })
    }

    load().catch((e: unknown) => {
      const error = e instanceof Error ? e : new Error(String(e))
      console.warn('[tgfx] useImage failed to load:', error)
      settle({ data: null, error, loading: false })
    })
    return () => {
      active = false
    }
  }, [source])

  return state
}

/**
 * The bytes only, `null` until they are available. Use `useImageState` when you
 * need to tell "still loading" from "failed".
 */
export function useImage(source: number | string): string | null {
  return useImageState(source).data
}
