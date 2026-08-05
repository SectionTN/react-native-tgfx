import NitroModules
import UIKit

/** iOS `TgfxView`: a thin Swift shell over the Objective-C++ `TgfxMetalView`. */
final class HybridTgfxView: HybridTgfxViewSpec {
  private let metalView = TgfxMetalView()

  var view: UIView { metalView }

  var inHierarchy: Bool = false

  var opaque: Bool = false {
    didSet {
      metalView.setOpaqueSurface(opaque)
    }
  }

  func setScene(scene: ArrayBuffer, strings: [String]) throws {
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

  func snapshot(options: NativeSnapshotOptions) throws -> Promise<NativeSnapshot> {
    let promise = Promise<NativeSnapshot>()
    read(options, path: nil) { bytes, size, token, width, height in
      guard let bytes, let token else {
        promise.reject(withError: RuntimeError.error(withMessage:
          "[tgfx] snapshot: the readback produced no bytes"))
        return
      }
      // Zero-copy: the buffer stays alive in C++ until JS drops the ArrayBuffer.
      let data = ArrayBuffer.wrap(dataWithoutCopy: bytes, size: size) {
        TgfxSnapshotRelease(token)
      }
      promise.resolve(withResult: NativeSnapshot(
        data: data, width: Double(width), height: Double(height),
        format: options.format))
    } onError: { message in
      promise.reject(withError: RuntimeError.error(withMessage: message))
    }
    return promise
  }

  func save(path: String, options: NativeSnapshotOptions) throws -> Promise<Void> {
    let promise = Promise<Void>()
    read(options, path: path) { _, _, _, _, _ in
      promise.resolve()
    } onError: { message in
      promise.reject(withError: RuntimeError.error(withMessage: message))
    }
    return promise
  }

  private func read(
    _ options: NativeSnapshotOptions,
    path: String?,
    onSuccess: @escaping (UnsafeMutableRawPointer?, Int, UnsafeMutableRawPointer?, Int32, Int32) -> Void,
    onError: @escaping (String) -> Void
  ) {
    metalView.snapshot(
      withFormat: options.format,
      quality: Int32(options.quality),
      rect: CGRect(x: options.x, y: options.y,
                   width: options.width, height: options.height),
      scale: Float(options.scale),
      path: path
    ) { bytes, size, token, width, height, error in
      if let error {
        onError(error)
        return
      }
      onSuccess(bytes, size, token, width, height)
    }
  }

  func onDropView() {
    metalView.releaseRenderer()
  }
}
