cmake_minimum_required(VERSION 3.18.0)
project(TgfxSceneTest CXX)

set(CMAKE_CXX_STANDARD 20)
set(TGFX_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../third_party/tgfx")

set(TGFX_USE_METAL ON CACHE BOOL "" FORCE)
set(TGFX_USE_OPENGL OFF CACHE BOOL "" FORCE)
set(TGFX_BUILD_LAYERS OFF CACHE BOOL "" FORCE)
set(TGFX_BUILD_SVG OFF CACHE BOOL "" FORCE)
set(TGFX_BUILD_PDF OFF CACHE BOOL "" FORCE)
set(TGFX_BUILD_HELLO2D OFF CACHE BOOL "" FORCE)
add_subdirectory(${TGFX_DIR} ${CMAKE_BINARY_DIR}/tgfx)

add_executable(SceneTest SceneTest.cpp ../TgfxScene.cpp ../SvgPath.cpp ../ImageRegistry.cpp
               ../FontRegistry.cpp ../TextLayout.cpp)
target_include_directories(SceneTest PRIVATE ".." "${TGFX_DIR}/include")
# Real font faces to register, shared with the example app so the tests exercise
# files that ship in this repo rather than whatever the host happens to install.
target_compile_definitions(SceneTest PRIVATE
    TGFXRN_TEST_FONT_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../../../../apps/example/src/assets/fonts")
target_link_libraries(SceneTest tgfx)

add_executable(SnapshotTest SnapshotTest.cpp)
target_include_directories(SnapshotTest PRIVATE ".." "${TGFX_DIR}/include")
target_link_libraries(SnapshotTest tgfx)

add_executable(AllocBench AllocBench.cpp ../TgfxScene.cpp ../SvgPath.cpp ../ImageRegistry.cpp
               ../TgfxFrameSink.cpp ../FontRegistry.cpp ../TextLayout.cpp)
target_include_directories(AllocBench PRIVATE ".." "${TGFX_DIR}/include")
target_link_libraries(AllocBench tgfx)
