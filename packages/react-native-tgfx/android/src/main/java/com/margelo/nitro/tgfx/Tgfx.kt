package com.margelo.nitro.tgfx

/** Public entry points that do not need a React context or a JS runtime. */
object Tgfx {
  /**
   * Loads libNitroTgfx, builds the GPU device and the font table on the render
   * thread, so the first canvas only has to make its window. Call it from
   * `Application.onCreate`; it returns immediately and touches no JSI, so it is
   * safe long before the React host exists. Idempotent.
   */
  @JvmStatic
  fun prewarm() {
    TgfxRenderThread.handler.post { TgfxNative.prewarm() }
  }
}
