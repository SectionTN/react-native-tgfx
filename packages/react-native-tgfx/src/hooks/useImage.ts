import { useEffect, useState } from 'react'
import { Image as RNImage } from 'react-native'
import { bytesToBase64 } from './base64'

/**
 * Load an image source into base64 bytes suitable for `<Image image={...} />`.
 *
 * Accepts a `require('./pic.png')` asset, an `http(s)://`, `file://`, `data:` or
 * `asset:`/`content:` URI, or a raw base64 string (returned as-is). Returns
 * `null` until the bytes are available.
 */
export function useImage(source: number | string): string | null {
  const [data, setData] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function load(): Promise<void> {
      let uri: string | null = null
      if (typeof source === 'number') {
        const resolved = RNImage.resolveAssetSource(source)
        uri = resolved?.uri ?? null
      } else if (/^(https?:|file:|data:|content:|asset:)/.test(source)) {
        uri = source
      } else {
        // Already a base64 payload.
        if (active) {
          setData(source)
        }
        return
      }
      if (uri == null) {
        return
      }
      if (uri.startsWith('data:')) {
        const comma = uri.indexOf(',')
        if (active) {
          setData(comma >= 0 ? uri.slice(comma + 1) : uri)
        }
        return
      }
      const res = await fetch(uri)
      const buf = await res.arrayBuffer()
      const b64 = bytesToBase64(new Uint8Array(buf))
      if (active) {
        setData(b64)
      }
    }

    load().catch((e) => console.warn('[tgfx] useImage failed to load:', e))
    return () => {
      active = false
    }
  }, [source])

  return data
}
