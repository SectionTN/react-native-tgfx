project(NitroTgfxCamera)
cmake_minimum_required(VERSION 3.18.0)

set(PACKAGE_NAME NitroTgfxCamera)
set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 20)

add_library(${PACKAGE_NAME} SHARED
        src/main/cpp/cpp-adapter.cpp
        ../cpp/HybridTgfxCameraSink.cpp
)

# Add Nitrogen specs :)
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/NitroTgfxCamera+autolinking.cmake)

target_include_directories(${PACKAGE_NAME} PRIVATE
        "src/main/cpp"
        "../cpp"
)

find_library(LOG_LIB log)
# For HybridCameraFrameOutputSpec / HybridFrameSpec / HybridNativeThreadSpec.
find_package(react-native-vision-camera REQUIRED)
# For tgfxrn::setFrame — the *only* thing this package needs out of tgfx. It
# links libNitroTgfx.so rather than compiling any of it, which is what keeps the
# private tgfx submodule, the tgfx headers and the tgfx static library out of
# this package's build entirely.
find_package(react-native-tgfx REQUIRED)

target_link_libraries(
        ${PACKAGE_NAME}
        ${LOG_LIB}
        android
        react-native-vision-camera::VisionCamera
        react-native-tgfx::NitroTgfx
)
