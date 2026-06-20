const CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Encode raw bytes to a standard base64 string (no data-URI prefix). */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  const len = bytes.length
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i] ?? 0
    const b1 = i + 1 < len ? (bytes[i + 1] ?? 0) : 0
    const b2 = i + 2 < len ? (bytes[i + 2] ?? 0) : 0
    const triple = (b0 << 16) | (b1 << 8) | b2
    const c0 = CHARS[(triple >> 18) & 0x3f] ?? 'A'
    const c1 = CHARS[(triple >> 12) & 0x3f] ?? 'A'
    const c2 = i + 1 < len ? (CHARS[(triple >> 6) & 0x3f] ?? 'A') : '='
    const c3 = i + 2 < len ? (CHARS[triple & 0x3f] ?? 'A') : '='
    out += c0 + c1 + c2 + c3
  }
  return out
}
