require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "NitroTgfx"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  # :text, not :file — acknowledgements render one blob, and NOTICE belongs in it.
  s.license      = { :type => package["license"], :text => ["LICENSE", "NOTICE"].map { |f| File.read(File.join(__dir__, f), encoding: "UTF-8") }.join("\n") }
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/riteshshukla04/react-native-tgfx.git", :tag => "#{s.version}" }
  s.preserve_paths = ["LICENSE", "NOTICE"]

  # IMPORTANT: only our own sources — NOT cpp/third_party/tgfx (built separately
  # into a static lib by scripts/build-tgfx-ios.sh and linked via vendored_libraries).
  s.source_files = [
    # Implementation (Swift)
    "ios/**/*.{swift}",
    # Objective-C(++) view + bridging header
    "ios/**/*.{h,m,mm}",
    # Shared C++ engine (top-level cpp/ only)
    "cpp/*.{hpp,cpp}",
  ]

  tgfx_dir = "$(PODS_TARGET_SRCROOT)/cpp/third_party/tgfx"

  # Export contract for other native packages (see cpp/TgfxFrameSink.hpp): a pod
  # that declares `s.dependency "NitroTgfx"` links this pod's objects into the
  # same binary, so `tgfxrn::setFrame` resolves and there is exactly one
  # ImageRegistry. The header reaches it as <NitroTgfx/TgfxFrameSink.hpp> from
  # CocoaPods' per-pod header dir; the consumer adds the search path, because
  # making cpp/*.hpp public here would drag C++ into this pod's Obj-C umbrella
  # and break the Swift side. Android's equivalent is the prefab in
  # android/build.gradle.
  #
  # The Obj-C(++) view header is exposed through the module umbrella (NOT a Swift
  # bridging header — those are unsupported for framework/module pod targets), so
  # the Swift HybridTgfxView can see TgfxMetalView in-module. Its C++ guts stay
  # in the .mm; the header itself is pure Obj-C.
  s.public_header_files = "ios/TgfxMetalView.h"

  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
    "HEADER_SEARCH_PATHS" => [
      "\"#{tgfx_dir}/include\"",
      "\"#{tgfx_dir}/third_party/json/single_include\"",
      "\"$(PODS_TARGET_SRCROOT)/cpp\"",
    ].join(" "),
    "OTHER_LDFLAGS" => "-lc++",
  }

  # Prebuilt tgfx (+ vendored deps) static library. Build it first with:
  #   node packages/react-native-tgfx/scripts/build-tgfx-ios.js   (or the .sh)
  s.vendored_libraries = "ios/libs/libtgfx-ios.a"

  s.frameworks = "Metal", "QuartzCore", "CoreText", "CoreGraphics", "UIKit", "Foundation"

  load 'nitrogen/generated/ios/NitroTgfx+autolinking.rb'
  add_nitrogen_files(s)

  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  install_modules_dependencies(s)
end
