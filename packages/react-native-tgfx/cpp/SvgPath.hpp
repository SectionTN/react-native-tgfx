// Parses an SVG path-data string ("M0 0 L10 10 C ... Z") into a tgfx::Path.
// Supports M/L/H/V/C/S/Q/T/Z (absolute + relative). Elliptical arcs (A/a) are
// approximated with a straight line to the endpoint.
#pragma once

#include <string>
#include "tgfx/core/Path.h"

namespace tgfxrn {

tgfx::Path parseSvgPath(const std::string& data);

}  // namespace tgfxrn
