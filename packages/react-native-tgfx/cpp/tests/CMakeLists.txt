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

add_executable(SceneTest SceneTest.cpp ../TgfxScene.cpp ../SvgPath.cpp)
target_include_directories(SceneTest PRIVATE ".." "${TGFX_DIR}/include")
target_link_libraries(SceneTest tgfx)
