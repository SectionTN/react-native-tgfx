import NitroModules
import UIKit

/**
 * iOS implementation of the Nitro `TgfxView`. A thin Swift shell over the
 * Objective-C++ `TgfxMetalView` (which owns the `CAMetalLayer`, the display
 * link, and the shared C++ tgfx renderer). The `scene` prop is forwarded to the
 * native renderer; GPU resources are released when the view is dropped.
 */
final class HybridTgfxView: HybridTgfxViewSpec {
  private let metalView = TgfxMetalView()

  var view: UIView { metalView }

  var scene: String = "" {
    didSet {
      metalView.setSceneJSON(scene)
    }
  }

  var valuesBuffer: ArrayBuffer? = nil

  var valueCount: Double? = nil

  func invalidate() throws {
    metalView.requestRender()
  }

  func setValues(values: [Double]) throws {
    metalView.setValues(values.map { NSNumber(value: $0) })
  }

  func onDropView() {
    metalView.releaseRenderer()
  }
}
