# Changelog

## [0.0.2-alpha.0](https://github.com/riteshshukla04/react-native-tgfx/compare/react-native-tgfx%401.0.0-alpha.0...react-native-tgfx%400.0.2-alpha.0) (2026-08-05)

### Bug Fixes

* address the full-repo audit findings in [#162](https://github.com/riteshshukla04/react-native-tgfx/issues/162) ([#163](https://github.com/riteshshukla04/react-native-tgfx/issues/163)) ([c66a042](https://github.com/riteshshukla04/react-native-tgfx/commit/c66a042f3ff7a48a231408ee0651284489383939))
* **release:** keep versions on the 0.0.x prerelease line ([0943e58](https://github.com/riteshshukla04/react-native-tgfx/commit/0943e58200af1cce452a22d2fd9345a9ebc3a969))

## [1.0.0-alpha.0](https://github.com/riteshshukla04/react-native-tgfx/compare/v0.0.1-alpha.1...react-native-tgfx%401.0.0-alpha.0) (2026-08-04)

### ⚠ BREAKING CHANGES

* **camera:** TgfxViewMethods.drawCameraFrame is removed. It drew the
  frame and blurred a polygon list without replaying the scene, so no child of
  the React tree was drawn on a camera canvas. Use <CameraFrame image={handle}>
  inside a normal <Canvas>; contours stay in frame pixels either way.

### Features

* **camera:** a native frame-processor plugin, and a C++ export contract for it ([#149](https://github.com/riteshshukla04/react-native-tgfx/issues/149)) ([#154](https://github.com/riteshshukla04/react-native-tgfx/issues/154)) ([dc89078](https://github.com/riteshshukla04/react-native-tgfx/commit/dc890785d313acd6ed9e0c2559267ac66472618b))
* **camera:** camera frames as a scene input via <CameraFrame> ([#148](https://github.com/riteshshukla04/react-native-tgfx/issues/148)) ([bb3dc94](https://github.com/riteshshukla04/react-native-tgfx/commit/bb3dc9418dd8c265a5f223b980bacbb629cf3af1))
* **camera:** useCameraFrame owns the buffer lifetime ([#149](https://github.com/riteshshukla04/react-native-tgfx/issues/149)) ([#152](https://github.com/riteshshukla04/react-native-tgfx/issues/152)) ([65d0b80](https://github.com/riteshshukla04/react-native-tgfx/commit/65d0b80db7de06d207f3960dd92170caf0c588fa))
* Canvas.snapshot() and Canvas.save() without stalling the render loop ([#137](https://github.com/riteshshukla04/react-native-tgfx/issues/137)) ([9e9c324](https://github.com/riteshshukla04/react-native-tgfx/commit/9e9c324dd100e08156d69fea6f93ec5916b484b0))
* **image:** native image handles, hardware buffers, and Skia-parity <Image> + <ImageShader> ([#136](https://github.com/riteshshukla04/react-native-tgfx/issues/136)) ([472d471](https://github.com/riteshshukla04/react-native-tgfx/commit/472d4713d6deb3b7809e220f5dea6c12bcd2cd96))
* **imperative:** colour, transform and uniform slots, plus an imperative docs page ([#161](https://github.com/riteshshukla04/react-native-tgfx/issues/161)) ([63f567a](https://github.com/riteshshukla04/react-native-tgfx/commit/63f567a733c8aa2ed8409f1f6cb67f3fdedf31e3))
* **imperative:** node handles that change a mounted scene without React ([#155](https://github.com/riteshshukla04/react-native-tgfx/issues/155)) ([#156](https://github.com/riteshshukla04/react-native-tgfx/issues/156)) ([0c6ddaa](https://github.com/riteshshukla04/react-native-tgfx/commit/0c6ddaae4217794c3eace8fe1e4ab92c52e8e519))
* **scene:** colour filters, blend modes and image filters as paint children ([#140](https://github.com/riteshshukla04/react-native-tgfx/issues/140)) ([acecacd](https://github.com/riteshshukla04/react-native-tgfx/commit/acecacd026773d6f00eda3036412dd315852d346))
* **shaders:** child shaders — uniform shader, .eval() and sample() ([#147](https://github.com/riteshshukla04/react-native-tgfx/issues/147)) ([b5e810f](https://github.com/riteshshukla04/react-native-tgfx/commit/b5e810f6a5a3795fd666b08824aaa946295f830a))
* **shaders:** support helper functions in SkSL sources ([#138](https://github.com/riteshshukla04/react-native-tgfx/issues/138)) ([aab52b9](https://github.com/riteshshukla04/react-native-tgfx/commit/aab52b99168790d4fcfa3e9447f70873e69b5d10)), references [#136](https://github.com/riteshshukla04/react-native-tgfx/issues/136)
* **text:** font manager, weight/style, paragraphs, measurement and <TextPath> ([#142](https://github.com/riteshshukla04/react-native-tgfx/issues/142)) ([1ab6581](https://github.com/riteshshukla04/react-native-tgfx/commit/1ab65813dccf9f72398a91cb8aacafb5a1c380d1)), references [#140](https://github.com/riteshshukla04/react-native-tgfx/issues/140)
* **text:** styled runs, per-line metrics, textPath() and <Glyphs> ([#145](https://github.com/riteshshukla04/react-native-tgfx/issues/145)) ([#159](https://github.com/riteshshukla04/react-native-tgfx/issues/159)) ([21c2f79](https://github.com/riteshshukla04/react-native-tgfx/commit/21c2f790868fc91aaca3de284e7680868f614746))

### Bug Fixes

* **android:** decode images in-process so EXIF orientation survives ([#151](https://github.com/riteshshukla04/react-native-tgfx/issues/151)) ([#158](https://github.com/riteshshukla04/react-native-tgfx/issues/158)) ([bce74e1](https://github.com/riteshshukla04/react-native-tgfx/commit/bce74e1cf05d922312a4c13f904a0c96c70e780d))
* **android:** set the tgfx JavaVM in JNI_OnLoad ([#150](https://github.com/riteshshukla04/react-native-tgfx/issues/150)) ([643f865](https://github.com/riteshshukla04/react-native-tgfx/commit/643f86530ede71921f3f7622e2c46451214135b7))
* **camera:** map any producer's pixel format, not just BT.601 ([f4e1356](https://github.com/riteshshukla04/react-native-tgfx/commit/f4e1356c784353c52c714b38426100f428c53b8f))
* **deps:** align react-native-worklets with reanimated's peer range ([6e54dce](https://github.com/riteshshukla04/react-native-tgfx/commit/6e54dce495f6446df990cd53de649a155d0fc940))
* minor build issues ([c354a1a](https://github.com/riteshshukla04/react-native-tgfx/commit/c354a1a9f7518b92f1d59f5d6455170adc0b0dc4))
* pack only the tgfx sources the native build compiles ([#119](https://github.com/riteshshukla04/react-native-tgfx/issues/119)) ([e9aaa8a](https://github.com/riteshshukla04/react-native-tgfx/commit/e9aaa8a36f1904978e1d3ece30a4d8a755487540))
* pack only the tgfx sources the native build compiles ([#119](https://github.com/riteshshukla04/react-native-tgfx/issues/119)) ([#122](https://github.com/riteshshukla04/react-native-tgfx/issues/122)) ([5f7cbf2](https://github.com/riteshshukla04/react-native-tgfx/commit/5f7cbf2a5c3131d5164cdaba2e8cd192acaaeafa))
* shader positions are points, and useClock ticks in seconds ([#123](https://github.com/riteshshukla04/react-native-tgfx/issues/123)) ([9f5871a](https://github.com/riteshshukla04/react-native-tgfx/commit/9f5871a4f1cded67e57f1a019f266c4cdfb1057d))

### Reverts

* release pipeline and tarball allowlist pending verification ([#121](https://github.com/riteshshukla04/react-native-tgfx/issues/121)) ([f6a1157](https://github.com/riteshshukla04/react-native-tgfx/commit/f6a115780b1f7a0b2bbd76bb671d2e6ab837131d))

## 0.0.1-alpha.1 (2026-08-02)

### Features

* add Fill and useClock ([#114](https://github.com/riteshshukla04/react-native-tgfx/issues/114)) ([43b5985](https://github.com/riteshshukla04/react-native-tgfx/commit/43b5985d1d9ffe5365d404e43e0512fa8bd2c9b7))
* animate shader uniforms on the UI thread ([#113](https://github.com/riteshshukla04/react-native-tgfx/issues/113)) ([19bcc78](https://github.com/riteshshukla04/react-native-tgfx/commit/19bcc7842548499fa5db8c27a776b4881f3aee51))
* composite prop to choose SurfaceView or TextureView on Android ([d5623b0](https://github.com/riteshshukla04/react-native-tgfx/commit/d5623b0446a3c36ad6a016d802db52671801f3f9))
* opaque prop for a canvas that composites without an alpha channel ([06a1460](https://github.com/riteshshukla04/react-native-tgfx/commit/06a1460f0cf45326c916c6cbe5d02d66117f5309))
* react-native-tgfx — declarative GPU 2D canvas via Nitro + tgfx ([f0adb4f](https://github.com/riteshshukla04/react-native-tgfx/commit/f0adb4fee7d9a3203ca7f5c02add33bb82aff9b2))

### Bug Fixes

* **android:** guard nativePtr against release racing the staging calls ([#56](https://github.com/riteshshukla04/react-native-tgfx/issues/56)) ([54a21dd](https://github.com/riteshshukla04/react-native-tgfx/commit/54a21dde67bb351256d71e29a8115f76ea7c2888))
* **android:** route a SurfaceView size change to surfaceResized instead of a rebind ([#63](https://github.com/riteshshukla04/react-native-tgfx/issues/63)) ([b6eeed9](https://github.com/riteshshukla04/react-native-tgfx/commit/b6eeed9d5633807f38f2a7f86007890919a09e3b))
* animate strokeWidth instead of snapshotting it ([#72](https://github.com/riteshshukla04/react-native-tgfx/issues/72)) ([cd5c4de](https://github.com/riteshshukla04/react-native-tgfx/commit/cd5c4de147ec88bf80729dfdacfc7ad3e17c68ac)), references [#49](https://github.com/riteshshukla04/react-native-tgfx/issues/49)
* apply the tgfx CONFIG_DIR change from patches/ instead of rewriting the submodule ([#83](https://github.com/riteshshukla04/react-native-tgfx/issues/83)) ([65d0586](https://github.com/riteshshukla04/react-native-tgfx/commit/65d05865877d730ea25bcde05a2561ee595a2324))
* atomic pixelRatio, constexpr base64 table, bounded scene recursion ([#46](https://github.com/riteshshukla04/react-native-tgfx/issues/46)) ([#79](https://github.com/riteshshukla04/react-native-tgfx/issues/79)) ([07773a9](https://github.com/riteshshukla04/react-native-tgfx/commit/07773a9ec5dcbea35a0018f269dbfb40e469f56b))
* clear stale image data and fail on non-ok responses in useImage ([#115](https://github.com/riteshshukla04/react-native-tgfx/issues/115)) ([f8798c6](https://github.com/riteshshukla04/react-native-tgfx/commit/f8798c672a424ce04e378731099905ea36783577))
* clear the image and typeface caches on the render thread ([#75](https://github.com/riteshshukla04/react-native-tgfx/issues/75)) ([8f1e0e0](https://github.com/riteshshukla04/react-native-tgfx/commit/8f1e0e014d3448835c38ca928f88de4aeb955874))
* evict one image from the cache instead of flushing all 32 ([#117](https://github.com/riteshshukla04/react-native-tgfx/issues/117)) ([e0ba861](https://github.com/riteshshukla04/react-native-tgfx/commit/e0ba8612dfbd572834fc3aed274ee0bf4948babe))
* hash the string table into the setScene dedupe key ([#55](https://github.com/riteshshukla04/react-native-tgfx/issues/55)) ([0d9e764](https://github.com/riteshshukla04/react-native-tgfx/commit/0d9e764d443c0dd1deade196e2d49dd3db34429b))
* **ios:** implement drawCameraFrame ([62bbbea](https://github.com/riteshshukla04/react-native-tgfx/commit/62bbbea07e84805856918bd66888483cd55d9f52))
* keep the Canvas reconciler root alive across a StrictMode remount ([#70](https://github.com/riteshshukla04/react-native-tgfx/issues/70)) ([43475c6](https://github.com/riteshshukla04/react-native-tgfx/commit/43475c6ace8fe082822cb11f3823ae54c4c479a8))
* make group, paint and image opacity actually apply ([#69](https://github.com/riteshshukla04/react-native-tgfx/issues/69)) ([f886138](https://github.com/riteshshukla04/react-native-tgfx/commit/f886138df7be0ea10f9468f74e8e4bc74409bd90))
* real package metadata ([#44](https://github.com/riteshshukla04/react-native-tgfx/issues/44)) and non-silent color parse failures ([#42](https://github.com/riteshshukla04/react-native-tgfx/issues/42)) ([#73](https://github.com/riteshshukla04/react-native-tgfx/issues/73)) ([3c3ff75](https://github.com/riteshshukla04/react-native-tgfx/commit/3c3ff758e2c69ed0d84ef2b0074286796d88a31c))
* **reanimated:** make the optional peer real and stop swallowing a broken install ([#53](https://github.com/riteshshukla04/react-native-tgfx/issues/53)) ([4698c9d](https://github.com/riteshshukla04/react-native-tgfx/commit/4698c9d4b60bd4f4faf8832b1a591679d360d919))
* render SVG elliptical arcs instead of flattening them to lines ([#80](https://github.com/riteshshukla04/react-native-tgfx/issues/80)) ([2022f6d](https://github.com/riteshshukla04/react-native-tgfx/commit/2022f6dded46fac1bd12991700d80592fb8da5b0))
* replace the racy iOS idle-frame counter with a wake generation ([#66](https://github.com/riteshshukla04/react-native-tgfx/issues/66)) ([80ffa98](https://github.com/riteshshukla04/react-native-tgfx/commit/80ffa9874680c1253a398ebab04be2e5ad8f5c8c))
* retain the Android camera buffer across the render hop, coalesce frames ([#84](https://github.com/riteshshukla04/react-native-tgfx/issues/84)) ([7e0289d](https://github.com/riteshshukla04/react-native-tgfx/commit/7e0289de1e35ab26ef4c2ff18384db279a010a22))
* ship license, notice, and built entrypoints in the npm package ([#116](https://github.com/riteshshukla04/react-native-tgfx/issues/116)) ([165abf2](https://github.com/riteshshukla04/react-native-tgfx/commit/165abf268e306088a74455a5111d87db7573d42b))
* stop the SVG path parser spinning on an implicit repeat of Z ([#67](https://github.com/riteshshukla04/react-native-tgfx/issues/67)) ([80c2bb3](https://github.com/riteshshukla04/react-native-tgfx/commit/80c2bb3ea9bb6cf69cab52e5163aa3572d55304d)), references [#58](https://github.com/riteshshukla04/react-native-tgfx/issues/58)
* **test:** update the mixed-group golden for the post-[#89](https://github.com/riteshshukla04/react-native-tgfx/issues/89) animated literal ([#94](https://github.com/riteshshukla04/react-native-tgfx/issues/94)) ([9e04a99](https://github.com/riteshshukla04/react-native-tgfx/commit/9e04a9926b4686d0469da90b78aa8b53455a7ede))
* write an animated field's current value as its literal, not zero ([#89](https://github.com/riteshshukla04/react-native-tgfx/issues/89)) ([76e0c68](https://github.com/riteshshukla04/react-native-tgfx/commit/76e0c6841191118896b16619a24c681629e3e2f6))

### Performance Improvements

* alias drawing components to their host type instead of wrapping them ([#54](https://github.com/riteshshukla04/react-native-tgfx/issues/54)) ([cc9aafb](https://github.com/riteshshukla04/react-native-tgfx/commit/cc9aafbe836b36e3d8e9c2a0a35d837bd259d66f))
* **android:** trace the render thread's phases ([#100](https://github.com/riteshshukla04/react-native-tgfx/issues/100)) ([5b7ce89](https://github.com/riteshshukla04/react-native-tgfx/commit/5b7ce892271c1b0431eb99b59ca72645ca7d8c66)), references [#24](https://github.com/riteshshukla04/react-native-tgfx/issues/24)
* binary scene wire format, SurfaceView canvas, off-main-thread iOS rendering ([978c7da](https://github.com/riteshshukla04/react-native-tgfx/commit/978c7da08d746407f7f6e112e14eef0fb2b35e3a))
* build a node's paint, line path and font once at setScene instead of per frame ([#93](https://github.com/riteshshukla04/react-native-tgfx/issues/93)) ([096fe27](https://github.com/riteshshukla04/react-native-tgfx/commit/096fe2794427a3c34158550c96e8223f9af1114a))
* build plain shape trees without mounting the reconciler ([#101](https://github.com/riteshshukla04/react-native-tgfx/issues/101)) ([1101644](https://github.com/riteshshukla04/react-native-tgfx/commit/1101644668683b519a9416a158e065e41b8a8383)), references [#24](https://github.com/riteshshukla04/react-native-tgfx/issues/24)
* cache parsed color strings instead of re-parsing per node per commit ([#61](https://github.com/riteshshukla04/react-native-tgfx/issues/61)) ([310e8fa](https://github.com/riteshshukla04/react-native-tgfx/commit/310e8fa9723a1e7ae3f25fbd915f5d6a72324fa3))
* compile-once render pipeline, dirty redraw, idle loop suspension ([c7a9662](https://github.com/riteshshukla04/react-native-tgfx/commit/c7a9662d8e622bc24674eb8b3fd0164b6f3d57f6))
* cut per-node allocations and string dispatch in the compile path ([7258f73](https://github.com/riteshshukla04/react-native-tgfx/commit/7258f736fca7fe6290bc5a0fa127d41db1affcfd))
* drop the per-group child filter, gradient probe, and angle closure ([#71](https://github.com/riteshshukla04/react-native-tgfx/issues/71)) ([66ecb27](https://github.com/riteshshukla04/react-native-tgfx/commit/66ecb273959f4e4f9a8c36d5d38f558819d1b66f))
* fold static group matrices, elide transform-free group saves, stop the per-frame allocation under the render lock ([#68](https://github.com/riteshshukla04/react-native-tgfx/issues/68)) ([2c026ec](https://github.com/riteshshukla04/react-native-tgfx/commit/2c026ec2a1c5b9998622b1fd3125502db43912e4))
* GPU render thread, tgfx runtime shaders, and a tgfx face-blur app ([9bb25f1](https://github.com/riteshshukla04/react-native-tgfx/commit/9bb25f15977a683d4e2561f9220f1c15b3c984e7))
* send the scene string table as a delta so image payloads cross once ([#92](https://github.com/riteshshukla04/react-native-tgfx/issues/92)) ([4c0d643](https://github.com/riteshshukla04/react-native-tgfx/commit/4c0d64345844234dd58629f928649cc646f571b3))
* **shader:** cache the SkSL transpile, and parse child declarations ([#111](https://github.com/riteshshukla04/react-native-tgfx/issues/111)) ([e77a18c](https://github.com/riteshshukla04/react-native-tgfx/commit/e77a18c0ce3fb840ae59024383ed3596059ccacb))
* stop clearing the image cache when the window is released ([#96](https://github.com/riteshshukla04/react-native-tgfx/issues/96)) ([610d2a9](https://github.com/riteshshukla04/react-native-tgfx/commit/610d2a9ccede77075efae3aca942ce607b91c586))
