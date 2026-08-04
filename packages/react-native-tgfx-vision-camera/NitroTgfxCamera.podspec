require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "NitroTgfxCamera"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => package["repository"]["url"], :tag => "#{s.version}" }

  s.source_files = [
    "cpp/**/*.{hpp,cpp}",
  ]

  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
    # NitroTgfx keeps cpp/*.hpp out of its public header set on purpose (a C++
    # header in that pod's Obj-C umbrella would break its Swift target), so the
    # export contract is reached through CocoaPods' per-pod header dirs. Both
    # roots are listed because whether a pod's headers land under Public or
    # Private depends on its `public_header_files`, and this include has to
    # resolve either way. Android's equivalent is prefab.
    "HEADER_SEARCH_PATHS" => [
      "\"$(PODS_ROOT)/Headers/Public\"",
      "\"$(PODS_ROOT)/Headers/Private\"",
    ].join(" "),
  }

  load 'nitrogen/generated/ios/NitroTgfxCamera+autolinking.rb'
  add_nitrogen_files(s)

  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  # Both are link-time dependencies, not just header ones: `tgfxrn::setFrame`
  # and VisionCamera's generated spec vtables have to resolve in the same binary.
  # On iOS every pod's objects land in the app binary, so that is automatic.
  s.dependency 'NitroTgfx'
  s.dependency 'VisionCamera'
  install_modules_dependencies(s)
end
