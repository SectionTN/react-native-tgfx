// Parses SVG path data into a tgfx::Path. M/L/H/V/C/S/Q/T/A/Z, absolute and relative.
#pragma once

#include <string>
#include "tgfx/core/Path.h"

namespace tgfxrn {

tgfx::Path parseSvgPath(const std::string& data);

std::string pathToSvg(const tgfx::Path& path);

}  // namespace tgfxrn
