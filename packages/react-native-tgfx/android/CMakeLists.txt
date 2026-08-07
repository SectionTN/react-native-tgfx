project(NitroTgfx)
cmake_minimum_required(VERSION 3.18.0)

set(PACKAGE_NAME NitroTgfx)
set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 20)

set(TGFX_DIR "${CMAKE_SOURCE_DIR}/../cpp/third_party/tgfx")

# Prebuilt tgfx + its vendored static libs, one merged archive per ABI, built
# at publish time by scripts/build-tgfx-android.sh — an npm install compiles
# only the glue code below, never tgfx itself. Absent (a git checkout of the
# monorepo), fall back to building tgfx from source.
set(TGFX_LIB "${CMAKE_SOURCE_DIR}/libs/${ANDROID_ABI}/libtgfx.a")
if (EXISTS "${TGFX_LIB}")
  add_library(tgfx STATIC IMPORTED)
  set_target_properties(tgfx PROPERTIES IMPORTED_LOCATION "${TGFX_LIB}")
else ()

# --- Build tgfx from source (OpenGL ES backend for Android) ---
# tgfx's CMake unconditionally tries to git-sync shaderc's sub-deps, but shaderc
# is only compiled for the Metal/Vulkan/WebGPU backends. The OpenGL backend used
# here never needs it, so satisfy the existence check to skip the (offline-
# failing) sync step.
file(MAKE_DIRECTORY "${TGFX_DIR}/third_party/shaderc/third_party/glslang")

# Two edits to vendor_tools' vendor.cmake. Not patches: tgfx gitignores
# third_party/, which depsync re-fetches, so nothing here is tracked.
#
# 1. vendor-build guesses its source dir from argv[1], which breaks under the
#    workspace symlink (node_modules/react-native-tgfx -> packages/...). Force
#    `-s ${CONFIG_DIR}` so it finds vendor.json at the tgfx root.
# 2. Its arch table has no `i686` case, so the x86 ABI falls through to `arm`
#    and every vendored archive is built into — and read back from —
#    third_party/out/*/android/arm. The link then fails with "is incompatible
#    with elf_i386". x86_64/armeabi-v7a/arm64-v8a map correctly already.
set(_vendor_cml "${TGFX_DIR}/third_party/vendor_tools/vendor.cmake")
if (EXISTS "${_vendor_cml}")
  file(READ "${_vendor_cml}" _vendor_cml_content)
  set(_vendor_cml_original "${_vendor_cml_content}")
  if (NOT _vendor_cml_content MATCHES "vendor-build -s ")
    string(REPLACE
      "node \${VENDOR_TOOLS_DIR}/vendor-build "
      "node \${VENDOR_TOOLS_DIR}/vendor-build -s \${CONFIG_DIR} "
      _vendor_cml_content "${_vendor_cml_content}")
  endif ()
  if (NOT _vendor_cml_content MATCHES "i686")
    string(REPLACE
      "    elseif (CMAKE_SYSTEM_PROCESSOR STREQUAL \"x86_64\")\n        set(ARCH x64)\n    else ()"
      "    elseif (CMAKE_SYSTEM_PROCESSOR STREQUAL \"x86_64\")\n        set(ARCH x64)\n    elseif (CMAKE_SYSTEM_PROCESSOR STREQUAL \"i686\")\n        set(ARCH x86)\n    else ()"
      _vendor_cml_content "${_vendor_cml_content}")
  endif ()
  if (NOT _vendor_cml_content STREQUAL _vendor_cml_original)
    file(WRITE "${_vendor_cml}" "${_vendor_cml_content}")
  endif ()
  if (ANDROID_ABI STREQUAL "x86" AND NOT _vendor_cml_content MATCHES "i686")
    message(FATAL_ERROR
      "vendor.cmake still has no i686 arch case, so the x86 ABI would link the \
armeabi-v7a archives. Upstream must have reshaped the arch table; re-check the \
string(REPLACE) above.")
  endif ()
endif ()

set(TGFX_USE_OPENGL ON CACHE BOOL "" FORCE)
set(TGFX_USE_METAL OFF CACHE BOOL "" FORCE)
set(TGFX_USE_VULKAN OFF CACHE BOOL "" FORCE)
set(TGFX_USE_WEBGPU OFF CACHE BOOL "" FORCE)
set(TGFX_USE_QT OFF CACHE BOOL "" FORCE)
set(TGFX_BUILD_LAYERS OFF CACHE BOOL "" FORCE)
# On for SVGDOM (cpp/SvgImage.cpp); pulls in the vendored expat, and forces
# TGFX_USE_PNG_ENCODE/TGFX_USE_JPEG_DECODE, which are already on below.
# +545 KB of stripped arm64 libNitroTgfx, measured (4.89 MB -> 5.45 MB).
set(TGFX_BUILD_SVG ON CACHE BOOL "" FORCE)
set(TGFX_BUILD_PDF OFF CACHE BOOL "" FORCE)
set(TGFX_BUILD_HELLO2D OFF CACHE BOOL "" FORCE)
# tgfx only declares its embedded codec options for desktop targets (its
# CMakeLists gates them on `NOT ANDROID AND NOT OHOS`), because Android normally
# decodes through android.graphics.Bitmap. There is no matching platform
# *encoder* behind ImageCodec::Encode, so Canvas.snapshot()/save() need the
# embedded ones turned on explicitly — otherwise Encode returns null at runtime.
# Setting the cache entries here still works: the `if (TGFX_USE_*_ENCODE)`
# checks read them whether or not `option()` declared them.
set(TGFX_USE_PNG_ENCODE ON CACHE BOOL "" FORCE)
set(TGFX_USE_JPEG_ENCODE ON CACHE BOOL "" FORCE)
set(TGFX_USE_WEBP_ENCODE ON CACHE BOOL "" FORCE)
# The decoders, for the same reason and one more. Android's default is
# BitmapFactory through JNI, which reads EXIF orientation only if
# androidx.exifinterface is on the classpath — a photo shot in portrait
# otherwise draws sideways. The embedded codecs parse the EXIF marker
# themselves (JpegCodec::MakeFromData, WebpCodec), decode in-process with no JNI
# round trip, and are the same code the host tests exercise, so the behaviour
# can be tested at all. PNG was already on, but only incidentally, via
# `if (TGFX_USE_FREETYPE) set(TGFX_USE_PNG_DECODE ON)`.
# Nearly free: libjpeg-turbo and libwebp are already linked for the encoders
# above, and only tgfx's own read paths are added — 1.4 KB of arm64 libNitroTgfx,
# measured. Formats neither library covers (HEIF, AVIF) still take the platform
# decoder, which is why androidx.exifinterface is a dependency too.
set(TGFX_USE_PNG_DECODE ON CACHE BOOL "" FORCE)
set(TGFX_USE_JPEG_DECODE ON CACHE BOOL "" FORCE)
set(TGFX_USE_WEBP_DECODE ON CACHE BOOL "" FORCE)
add_subdirectory(${TGFX_DIR} ${CMAKE_BINARY_DIR}/tgfx)

# `set(... FORCE)` above only sets a cache entry; what decides whether a codec is
# compiled in is the define reaching tgfx. tgfx re-exports its define list to the
# parent scope, so assert against that rather than against our own input —
# upstream renaming an option, or gating it differently, would otherwise fall
# back to the platform decoder silently.
foreach (_codec TGFX_USE_PNG_DECODE TGFX_USE_JPEG_DECODE TGFX_USE_WEBP_DECODE)
  if (NOT "${_codec}" IN_LIST TGFX_DEFINES)
    message(FATAL_ERROR
      "${_codec} did not reach tgfx: image decoding would fall back to \
BitmapFactory, which drops EXIF orientation. Check how tgfx's CMakeLists \
consumes the codec options.")
  endif ()
endforeach ()

endif ()

# --- Our shared C++ engine + JNI bridge ---
add_library(${PACKAGE_NAME} SHARED
        src/main/cpp/cpp-adapter.cpp
        src/main/cpp/TgfxAndroid.cpp
        src/main/cpp/TgfxVideoStream.cpp
        ../cpp/TgfxScene.cpp
        ../cpp/SvgPath.cpp
        ../cpp/SvgImage.cpp
        ../cpp/TgfxRenderer.cpp
        ../cpp/ImageRegistry.cpp
        ../cpp/TgfxFrameSink.cpp
        ../cpp/HybridTgfxImageFactory.cpp
        ../cpp/FontRegistry.cpp
        ../cpp/TextLayout.cpp
        ../cpp/HybridTgfxFonts.cpp
)

# Add Nitrogen specs :)
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/NitroTgfx+autolinking.cmake)

# Set up includes (local, shared engine, tgfx)
target_include_directories(${PACKAGE_NAME} PRIVATE
        "src/main/cpp"
        "../cpp"
        "${TGFX_DIR}/include"
)

find_library(LOG_LIB log)
find_library(ANDROID_LIB android)
find_library(EGL_LIB EGL)
find_library(GLES_LIB GLESv2)
# tgfx's in-tree build linked GLESv3 (ES3 entry points like
# glVertexAttribDivisor) and jnigraphics (AndroidBitmap_*) itself; the prebuilt
# archive needs them supplied here.
find_library(GLES3_LIB GLESv3)
find_library(JNIGRAPHICS_LIB jnigraphics)

# Link all libraries together
target_link_libraries(
        ${PACKAGE_NAME}
        ${LOG_LIB}
        ${ANDROID_LIB}
        ${EGL_LIB}
        ${GLES_LIB}
        ${GLES3_LIB}
        ${JNIGRAPHICS_LIB}
        tgfx                                      # <-- tgfx static lib (prebuilt or source)
)
