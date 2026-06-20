project(NitroTgfx)
cmake_minimum_required(VERSION 3.18.0)

set(PACKAGE_NAME NitroTgfx)
set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 20)

set(TGFX_DIR "${CMAKE_SOURCE_DIR}/../cpp/third_party/tgfx")

# --- Build tgfx from source (OpenGL ES backend for Android) ---
# tgfx's CMake unconditionally tries to git-sync shaderc's sub-deps, but shaderc
# is only compiled for the Metal/Vulkan/WebGPU backends. The OpenGL backend used
# here never needs it, so satisfy the existence check to skip the (offline-
# failing) sync step.
file(MAKE_DIRECTORY "${TGFX_DIR}/third_party/shaderc/third_party/glslang")

# When tgfx is embedded via add_subdirectory in an NDK/ninja build, its
# `add_vendor_target(tgfx-vendor ...)` call must be told where vendor.json lives
# (the tgfx root) — otherwise vendor-build runs with the wrong working dir. Patch
# it idempotently so clean checkouts of the submodule self-heal.
set(_tgfx_cml "${TGFX_DIR}/CMakeLists.txt")
file(READ "${_tgfx_cml}" _tgfx_cml_content)
if (NOT _tgfx_cml_content MATCHES "tgfx-vendor STATIC_VENDORS \\\${TGFX_STATIC_VENDORS} SHARED_VENDORS \\\${TGFX_SHARED_VENDORS} CONFIG_DIR")
  string(REPLACE
    "add_vendor_target(tgfx-vendor STATIC_VENDORS \${TGFX_STATIC_VENDORS} SHARED_VENDORS \${TGFX_SHARED_VENDORS})"
    "add_vendor_target(tgfx-vendor STATIC_VENDORS \${TGFX_STATIC_VENDORS} SHARED_VENDORS \${TGFX_SHARED_VENDORS} CONFIG_DIR \${CMAKE_CURRENT_SOURCE_DIR})"
    _tgfx_cml_content "${_tgfx_cml_content}")
  file(WRITE "${_tgfx_cml}" "${_tgfx_cml_content}")
endif ()

# vendor_tools' vendor-build guesses its source dir from argv[1], which breaks
# under the workspace symlink (node_modules/react-native-tgfx -> packages/...).
# Force `-s ${CONFIG_DIR}` so it finds vendor.json at the tgfx root.
set(_vendor_cml "${TGFX_DIR}/third_party/vendor_tools/vendor.cmake")
if (EXISTS "${_vendor_cml}")
  file(READ "${_vendor_cml}" _vendor_cml_content)
  if (NOT _vendor_cml_content MATCHES "vendor-build -s ")
    string(REPLACE
      "node \${VENDOR_TOOLS_DIR}/vendor-build "
      "node \${VENDOR_TOOLS_DIR}/vendor-build -s \${CONFIG_DIR} "
      _vendor_cml_content "${_vendor_cml_content}")
    file(WRITE "${_vendor_cml}" "${_vendor_cml_content}")
  endif ()
endif ()

set(TGFX_USE_OPENGL ON CACHE BOOL "" FORCE)
set(TGFX_USE_METAL OFF CACHE BOOL "" FORCE)
set(TGFX_USE_VULKAN OFF CACHE BOOL "" FORCE)
set(TGFX_USE_WEBGPU OFF CACHE BOOL "" FORCE)
set(TGFX_USE_QT OFF CACHE BOOL "" FORCE)
set(TGFX_BUILD_LAYERS OFF CACHE BOOL "" FORCE)
set(TGFX_BUILD_SVG OFF CACHE BOOL "" FORCE)
set(TGFX_BUILD_PDF OFF CACHE BOOL "" FORCE)
set(TGFX_BUILD_HELLO2D OFF CACHE BOOL "" FORCE)
add_subdirectory(${TGFX_DIR} ${CMAKE_BINARY_DIR}/tgfx)

# --- Our shared C++ engine + JNI bridge ---
add_library(${PACKAGE_NAME} SHARED
        src/main/cpp/cpp-adapter.cpp
        src/main/cpp/TgfxAndroid.cpp
        ../cpp/TgfxScene.cpp
        ../cpp/SvgPath.cpp
        ../cpp/TgfxRenderer.cpp
)

# Add Nitrogen specs :)
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/NitroTgfx+autolinking.cmake)

# Set up includes (local, shared engine, tgfx, nlohmann/json)
target_include_directories(${PACKAGE_NAME} PRIVATE
        "src/main/cpp"
        "../cpp"
        "${TGFX_DIR}/include"
        "${TGFX_DIR}/third_party/json/single_include"
)

find_library(LOG_LIB log)
find_library(ANDROID_LIB android)
find_library(EGL_LIB EGL)
find_library(GLES_LIB GLESv2)

# Link all libraries together
target_link_libraries(
        ${PACKAGE_NAME}
        ${LOG_LIB}
        ${ANDROID_LIB}
        ${EGL_LIB}
        ${GLES_LIB}
        tgfx                                      # <-- tgfx static lib
)
