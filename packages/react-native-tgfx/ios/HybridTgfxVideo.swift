import AVFoundation
import NitroModules
import QuartzCore

/// Quarter turns, wrapped: a `preferredTransform` reports signed degrees.
private func quarterTurns(_ degrees: Double) -> Double {
  let quarters = (degrees / 90).rounded().truncatingRemainder(dividingBy: 4)
  return (quarters < 0 ? quarters + 4 : quarters) * 90
}

/// `tgfxrn::FrameFormat`, which is what the registry shim takes.
private enum FrameFormat: Int32 {
  case bt601Limited = 1
  case bt709Limited = 3
  case bt2020Limited = 5
}

/// The matrix the track was encoded with — imported as the wrong one, the colours shift.
private func yCbCrMatrix(of track: AVAssetTrack) -> FrameFormat {
  guard let description = track.formatDescriptions.first else {
    return .bt709Limited
  }
  guard let matrix = CMFormatDescriptionGetExtension(
    description as! CMFormatDescription,
    extensionKey: kCMFormatDescriptionExtension_YCbCrMatrix) as? String
  else {
    return .bt709Limited
  }
  if matrix == kCMFormatDescriptionYCbCrMatrix_ITU_R_601_4 as String
      || matrix == kCMFormatDescriptionYCbCrMatrix_SMPTE_240M_1995 as String {
    return .bt601Limited
  }
  if matrix == kCMFormatDescriptionYCbCrMatrix_ITU_R_2020 as String {
    return .bt2020Limited
  }
  return .bt709Limited
}

/**
 * iOS `TgfxVideo`: AVPlayer decodes, and every frame leaves as the CVPixelBuffer
 * it decoded into — no conversion, no CPU copy, no pixels in JS.
 */
final class HybridTgfxVideo: HybridTgfxVideoSpec {
  private let player: AVPlayer
  private let output: AVPlayerItemVideoOutput
  // Holds the buffer handed out by the last acquireFrame() alive until the next one.
  private var retained: CVPixelBuffer?
  private var endObserver: NSObjectProtocol?
  private var seeked = false

  let duration: Double
  let framerate: Double
  let rotation: Double
  let width: Double
  let height: Double
  private let frameFormat: FrameFormat
  // The registry id this video's frames land in, allocated on the first one.
  private var imageHandle: Int32 = 0

  var currentTime: Double {
    let seconds = player.currentTime().seconds
    return seconds.isFinite ? seconds * 1000 : 0
  }

  var paused: Bool = true {
    didSet {
      if paused {
        player.pause()
      } else {
        player.play()
      }
    }
  }

  var looping: Bool = false

  var volume: Double = 1 {
    didSet {
      player.volume = Float(min(max(volume, 0), 1))
    }
  }

  init(asset: AVURLAsset, track: AVAssetTrack) {
    let seconds = asset.duration.seconds
    duration = seconds.isFinite ? seconds * 1000 : 0
    framerate = Double(track.nominalFrameRate)
    rotation = quarterTurns(
      atan2(Double(track.preferredTransform.b), Double(track.preferredTransform.a))
        * 180 / .pi)
    // The decoded buffer's size, unrotated — `rotation` is reported separately.
    width = Double(abs(track.naturalSize.width))
    height = Double(abs(track.naturalSize.height))
    frameFormat = yCbCrMatrix(of: track)

    // Bi-planar YUV is what the decoder already produces; tgfx samples it directly.
    let attributes: [String: Any] = [
      kCVPixelBufferPixelFormatTypeKey as String:
        kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
      kCVPixelBufferMetalCompatibilityKey as String: true,
      kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any](),
    ]
    output = AVPlayerItemVideoOutput(pixelBufferAttributes: attributes)
    let item = AVPlayerItem(asset: asset)
    item.add(output)
    player = AVPlayer(playerItem: item)
    super.init()

    endObserver = NotificationCenter.default.addObserver(
      forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: nil
    ) { [weak self] _ in
      guard let self, self.looping else { return }
      self.player.seek(to: .zero)
      if !self.paused {
        self.player.play()
      }
    }
  }

  deinit {
    release()
  }

  func release() {
    if let endObserver {
      NotificationCenter.default.removeObserver(endObserver)
      self.endObserver = nil
    }
    player.pause()
    player.replaceCurrentItem(with: nil)
    // An external entry is never evicted, so nothing else would ever free it.
    TgfxVideoFrameRemove(imageHandle)
    imageHandle = 0
    retained = nil
  }

  func seek(millis: Double) throws {
    // Paused, the output reports no *new* buffer, so a scrub would never redraw.
    seeked = true
    player.seek(
      to: CMTime(value: CMTimeValue(millis.rounded()), timescale: 1000),
      toleranceBefore: .zero, toleranceAfter: .zero)
  }

  func updateFrame() throws -> Double {
    let hostTime = output.itemTime(forHostTime: CACurrentMediaTime())
    var buffer: CVPixelBuffer?
    if output.hasNewPixelBuffer(forItemTime: hostTime) {
      buffer = output.copyPixelBuffer(forItemTime: hostTime, itemTimeForDisplay: nil)
    } else if seeked {
      buffer = output.copyPixelBuffer(forItemTime: player.currentTime(),
                                      itemTimeForDisplay: nil)
    }
    guard let buffer else {
      return 0
    }
    seeked = false
    let handle = TgfxVideoFrameSet(imageHandle, buffer, frameFormat.rawValue)
    if handle == 0 {
      return 0
    }
    imageHandle = handle
    // The store is the retain: tgfx samples the buffer until the next frame replaces it.
    retained = buffer
    return Double(handle)
  }
}

/** Opens a video source and reads the track metadata a scene needs to place it. */
final class HybridTgfxVideoFactory: HybridTgfxVideoFactorySpec {
  private static func url(for uri: String) -> URL? {
    if let url = URL(string: uri), url.scheme != nil {
      return url
    }
    return uri.isEmpty ? nil : URL(fileURLWithPath: uri)
  }

  func load(uri: String) throws -> Promise<(any HybridTgfxVideoSpec)> {
    let promise = Promise<(any HybridTgfxVideoSpec)>()
    guard let url = Self.url(for: uri) else {
      promise.reject(withError: RuntimeError.error(withMessage:
        "[tgfx] loadVideo: \(uri) is not a usable URL"))
      return promise
    }

    let asset = AVURLAsset(url: url)
    let assetKeys = ["duration", "tracks"]
    asset.loadValuesAsynchronously(forKeys: assetKeys) {
      for key in assetKeys {
        var error: NSError?
        guard asset.statusOfValue(forKey: key, error: &error) == .loaded else {
          promise.reject(withError: RuntimeError.error(withMessage:
            "[tgfx] loadVideo: \(uri) could not be opened: "
              + (error?.localizedDescription ?? "\(key) is unavailable")))
          return
        }
      }
      guard let track = asset.tracks(withMediaType: .video).first else {
        promise.reject(withError: RuntimeError.error(withMessage:
          "[tgfx] loadVideo: \(uri) has no video track"))
        return
      }

      let trackKeys = ["naturalSize", "preferredTransform", "nominalFrameRate",
                       "formatDescriptions"]
      track.loadValuesAsynchronously(forKeys: trackKeys) {
        for key in trackKeys {
          var error: NSError?
          guard track.statusOfValue(forKey: key, error: &error) == .loaded else {
            promise.reject(withError: RuntimeError.error(withMessage:
              "[tgfx] loadVideo: \(uri) has no readable \(key): "
                + (error?.localizedDescription ?? "unavailable")))
            return
          }
        }
        promise.resolve(withResult: HybridTgfxVideo(asset: asset, track: track))
      }
    }
    return promise
  }
}
