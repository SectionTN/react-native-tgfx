// Parses an SVG path-data string ("M0 0 L10 10 C ... Z") into a tgfx::Path.
// Supports M/L/H/V/C/S/Q/T/A/Z (absolute + relative).
#pragma once

#include <string>
#include "tgfx/core/Path.h"

namespace tgfxrn {

tgfx::Path parseSvgPath(const std::string& data);

/// The inverse: SVG path data for `path`, so a native path can go back to JS and
/// be handed to <Path> like any other. Absolute commands, conics expanded to
/// quads (SVG has no conic), which is exact for the 90° arcs a font emits.
std::string pathToSvg(const tgfx::Path& path);

}  // namespace tgfxrn
