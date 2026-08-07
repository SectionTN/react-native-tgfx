#include "PathOps.hpp"

#include <algorithm>
#include <cmath>
#include <vector>

#include "SvgPath.hpp"
#include "tgfx/core/Matrix.h"
#include "tgfx/core/PathMeasure.h"
#include "tgfx/core/PathTypes.h"
#include "tgfx/core/Point.h"

namespace tgfxrn {
namespace {

/// One contour, kept as its own path so tgfx can answer the nesting question below.
struct Contour {
  tgfx::Path path;
  std::vector<tgfx::Path::Segment> segments;
  tgfx::Point start = {};
  float area = 0;
};

/// Twice the signed area of the contour's polygon hull: sign is the winding direction.
float shoelace(const std::vector<tgfx::Path::Segment>& segments) {
  float sum = 0;
  tgfx::Point previous = {};
  bool first = true;
  auto edge = [&](const tgfx::Point& point) {
    if (!first) {
      sum += previous.x * point.y - point.x * previous.y;
    }
    first = false;
    previous = point;
  };
  for (const auto& segment : segments) {
    switch (segment.verb) {
      case tgfx::PathVerb::Move: edge(segment.points[0]); break;
      case tgfx::PathVerb::Line: edge(segment.points[1]); break;
      case tgfx::PathVerb::Quad: edge(segment.points[2]); break;
      case tgfx::PathVerb::Conic: edge(segment.points[2]); break;
      case tgfx::PathVerb::Cubic: edge(segment.points[3]); break;
      default: break;
    }
  }
  return sum;
}

void appendSegment(tgfx::Path& out, const tgfx::Path::Segment& segment) {
  switch (segment.verb) {
    case tgfx::PathVerb::Move: out.moveTo(segment.points[0]); break;
    case tgfx::PathVerb::Line: out.lineTo(segment.points[1]); break;
    case tgfx::PathVerb::Quad:
      out.quadTo(segment.points[1], segment.points[2]);
      break;
    case tgfx::PathVerb::Conic: {
      auto quads = tgfx::Path::ConvertConicToQuads(segment.points[0], segment.points[1],
                                                   segment.points[2], segment.conicWeight, 1);
      for (size_t i = 1; i + 1 < quads.size(); i += 2) {
        out.quadTo(quads[i], quads[i + 1]);
      }
      break;
    }
    case tgfx::PathVerb::Cubic:
      out.cubicTo(segment.points[1], segment.points[2], segment.points[3]);
      break;
    case tgfx::PathVerb::Close: out.close(); break;
    default: break;
  }
}

std::vector<Contour> splitContours(const tgfx::Path& path) {
  std::vector<Contour> contours;
  for (const auto& segment : path) {
    if (segment.verb == tgfx::PathVerb::Move) {
      contours.push_back({});
      contours.back().start = segment.points[0];
    }
    if (contours.empty()) {
      continue;
    }
    contours.back().segments.push_back(segment);
  }
  for (auto& contour : contours) {
    for (const auto& segment : contour.segments) {
      appendSegment(contour.path, segment);
    }
    contour.path.close();
    contour.area = shoelace(contour.segments);
  }
  return contours;
}

/// Walk a contour backwards, which flips its winding direction without moving any point.
void appendReversed(tgfx::Path& out, const std::vector<tgfx::Path::Segment>& segments) {
  std::vector<tgfx::Point> ends;
  std::vector<tgfx::Path::Segment> curves;
  for (const auto& segment : segments) {
    switch (segment.verb) {
      case tgfx::PathVerb::Move: ends.push_back(segment.points[0]); break;
      case tgfx::PathVerb::Line: ends.push_back(segment.points[1]); curves.push_back(segment); break;
      case tgfx::PathVerb::Quad: ends.push_back(segment.points[2]); curves.push_back(segment); break;
      case tgfx::PathVerb::Conic: ends.push_back(segment.points[2]); curves.push_back(segment); break;
      case tgfx::PathVerb::Cubic: ends.push_back(segment.points[3]); curves.push_back(segment); break;
      default: break;
    }
  }
  if (ends.empty()) {
    return;
  }
  out.moveTo(ends.back());
  for (size_t i = curves.size(); i > 0; i--) {
    const auto& segment = curves[i - 1];
    auto target = ends[i - 1];
    switch (segment.verb) {
      case tgfx::PathVerb::Quad: out.quadTo(segment.points[1], target); break;
      case tgfx::PathVerb::Conic: {
        auto quads = tgfx::Path::ConvertConicToQuads(segment.points[0], segment.points[1],
                                                     segment.points[2], segment.conicWeight, 1);
        for (size_t q = quads.size(); q >= 3; q -= 2) {
          out.quadTo(quads[q - 2], quads[q - 3]);
        }
        break;
      }
      case tgfx::PathVerb::Cubic:
        out.cubicTo(segment.points[2], segment.points[1], target);
        break;
      default: out.lineTo(target); break;
    }
  }
  out.close();
}

/**
 * Rewrite an even-odd path so non-zero winding fills the same region, by flipping
 * every contour nested at odd depth. Needed because SVG path data carries no fill
 * rule and `<Path>` parses as winding, so an un-flipped hole would fill solid.
 */
tgfx::Path toWinding(const tgfx::Path& path) {
  if (path.getFillType() != tgfx::PathFillType::EvenOdd || path.isEmpty()) {
    return path;
  }
  auto contours = splitContours(path);
  if (contours.size() < 2) {
    auto out = path;
    out.setFillType(tgfx::PathFillType::Winding);
    return out;
  }
  tgfx::Path out;
  for (size_t i = 0; i < contours.size(); i++) {
    int depth = 0;
    for (size_t j = 0; j < contours.size(); j++) {
      if (j != i && std::abs(contours[j].area) > std::abs(contours[i].area) &&
          contours[j].path.contains(contours[i].start.x, contours[i].start.y)) {
        depth++;
      }
    }
    bool wantPositive = (depth % 2 == 0) == (contours[0].area > 0);
    if ((contours[i].area > 0) == wantPositive) {
      for (const auto& segment : contours[i].segments) {
        appendSegment(out, segment);
      }
      out.close();
    } else {
      appendReversed(out, contours[i].segments);
    }
  }
  return out;
}

tgfx::PathOp opOf(const std::string& name) {
  if (name == "difference") {
    return tgfx::PathOp::Difference;
  }
  if (name == "intersect") {
    return tgfx::PathOp::Intersect;
  }
  if (name == "union") {
    return tgfx::PathOp::Union;
  }
  if (name == "xor") {
    return tgfx::PathOp::XOR;
  }
  return tgfx::PathOp::Append;
}

}  // namespace

std::string pathCombine(const std::string& a, const std::string& b, const std::string& op) {
  auto path = parseSvgPath(a);
  path.addPath(parseSvgPath(b), opOf(op));
  return pathToSvg(toWinding(path));
}

tgfx::Rect pathBounds(const std::string& path, bool tight) {
  auto parsed = parseSvgPath(path);
  return tight ? parsed.computeTightBounds() : parsed.getBounds();
}

bool pathContains(const std::string& path, float x, float y) {
  return parseSvgPath(path).contains(x, y);
}

std::string pathTransform(const std::string& path, const std::vector<double>& matrix) {
  auto parsed = parseSvgPath(path);
  if (matrix.size() < 6) {
    return pathToSvg(parsed);
  }
  auto at = [&](size_t i) { return static_cast<float>(matrix[i]); };
  parsed.transform(tgfx::Matrix::MakeAll(at(0), at(2), at(4), at(1), at(3), at(5)));
  return pathToSvg(parsed);
}

float pathLength(const std::string& path) {
  auto measure = tgfx::PathMeasure::MakeFrom(parseSvgPath(path));
  return measure == nullptr ? 0 : measure->getLength();
}

PathPointResult pathPointAtLength(const std::string& path, float distance) {
  auto measure = tgfx::PathMeasure::MakeFrom(parseSvgPath(path));
  tgfx::Point position = {};
  tgfx::Point tangent = {};
  if (measure == nullptr || !measure->getPosTan(distance, &position, &tangent)) {
    return {};
  }
  return {position.x, position.y, std::atan2(tangent.y, tangent.x), true};
}

std::string pathSegment(const std::string& path, float start, float stop) {
  auto measure = tgfx::PathMeasure::MakeFrom(parseSvgPath(path));
  tgfx::Path result;
  if (measure == nullptr || !measure->getSegment(start, stop, &result)) {
    return "";
  }
  return pathToSvg(result);
}

}  // namespace tgfxrn
