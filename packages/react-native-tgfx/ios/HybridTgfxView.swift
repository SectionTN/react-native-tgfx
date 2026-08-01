import NitroModules
import UIKit

/**
 * iOS implementation of the Nitro `TgfxView`. A thin Swift shell over the
 * Objective-C++ `TgfxMetalView` (which owns the `CAMetalLayer`, the display
 * link, and the shared C++ tgfx renderer).
 */
final class HybridTgfxView: HybridTgfxViewSpec {
  private let metalView = TgfxMetalView()

  var view: UIView { metalView }

  func setScene(scene: ArrayBuffer, strings: [String]) throws {
    // The buffer is only valid for this call; the engine copies what it needs.
    let words = UnsafeRawPointer(scene.data).assumingMemoryBound(to: Double.self)
    metalView.setScene(words, count: scene.size / MemoryLayout<Double>.size,
                       strings: strings)
  }

  func prepareForRecycle() {
    metalView.clearScene()
  }

  func invalidate() throws {
    metalView.requestRender()
  }

  func setValues(values: [Double]) throws {
    values.withUnsafeBufferPointer { buffer in
      guard let base = buffer.baseAddress else { return }
      metalView.setValues(base, count: Int32(buffer.count))
    }
  }

  func drawCameraFrame(
    buffer: UInt64,
    frameWidth: Double,
    frameHeight: Double,
    contours: [Double],
    blurRadius: Double
  ) throws {
    throw RuntimeError.error(withMessage: "drawCameraFrame is Android-only for now")
  }

  func onDropView() {
    metalView.releaseRenderer()
  }
}
