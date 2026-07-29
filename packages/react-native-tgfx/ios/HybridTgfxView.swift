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

  var scene: String = "" {
    didSet {
      metalView.setSceneJSON(scene)
    }
  }

  func invalidate() throws {
    metalView.requestRender()
  }

  func setValues(values: [Double]) throws {
    values.withUnsafeBufferPointer { buffer in
      metalView.setValues(buffer.baseAddress, count: Int32(buffer.count))
    }
  }

  func onDropView() {
    metalView.releaseRenderer()
  }
}
