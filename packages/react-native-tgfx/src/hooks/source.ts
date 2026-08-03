import { Image as RNImage } from 'react-native'

/**
 * The three ways bytes reach native. Images and fonts both have exactly these,
 * so the routing below — which of the three a given source needs — is written
 * once rather than once per asset kind.
 */
export interface SourceReader<T> {
  fromFile(path: string): Promise<T>
  fromBytes(bytes: ArrayBuffer): Promise<T>
  fromBase64(data: string): Promise<T>
}

/** The `data:` payload, or null when the URI is not one. */
function dataPayload(uri: string): string | null {
  if (!uri.startsWith('data:')) {
    return null
  }
  const comma = uri.indexOf(',')
  return comma >= 0 ? uri.slice(comma + 1) : ''
}

/**
 * Load a `require()`d asset, a URI or a raw base64 string through `api`.
 *
 * A local file is opened natively, so its bytes never enter JS at all. Only a
 * remote or Metro-served URI still goes through `fetch`, and then as an
 * `ArrayBuffer` — nothing is ever base64-encoded on the JS thread.
 */
export async function loadSource<T>(
  source: number | string,
  api: SourceReader<T>
): Promise<T> {
  let uri: string
  // A bundled asset may resolve to a bare path, which is a file. A caller's own
  // string never is: a JPEG's base64 starts "/9j/", so treating a leading slash
  // as a path there would misroute every JPEG payload.
  let bareIsPath = false
  if (typeof source === 'number') {
    const resolved = RNImage.resolveAssetSource(source)
    if (resolved?.uri == null) {
      throw new Error(`could not resolve asset source: ${String(source)}`)
    }
    uri = resolved.uri
    bareIsPath = true
  } else {
    uri = source
  }

  const payload = dataPayload(uri)
  if (payload != null) {
    return api.fromBase64(payload)
  }
  if (uri.startsWith('file:') || (bareIsPath && uri.startsWith('/'))) {
    return api.fromFile(uri)
  }
  if (/^(https?|content|asset):/.test(uri)) {
    const res = await fetch(uri)
    // A 404 body decodes to garbage rather than failing, so check first.
    if (!res.ok) {
      throw new Error(`${uri} returned HTTP ${res.status}`)
    }
    return api.fromBytes(await res.arrayBuffer())
  }
  return api.fromBase64(uri)
}
