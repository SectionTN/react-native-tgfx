#include "SvgPath.hpp"

#include <cctype>
#include <cmath>
#include <cstdlib>

namespace tgfxrn {

namespace {

struct Cursor {
  const char* p;
  const char* end;

  void skipSep() {
    while (p < end && (*p == ' ' || *p == ',' || *p == '\t' || *p == '\n' ||
                       *p == '\r')) {
      p++;
    }
  }

  bool hasNumber() {
    skipSep();
    if (p >= end) {
      return false;
    }
    char c = *p;
    return (c == '+' || c == '-' || c == '.' || (c >= '0' && c <= '9'));
  }

  float number() {
    skipSep();
    char* next = nullptr;
    float v = std::strtof(p, &next);
    if (next == p) {
      p = end;
      return 0.0f;
    }
    p = next;
    return v;
  }
};

}  // namespace

tgfx::Path parseSvgPath(const std::string& data) {
  tgfx::Path path;
  Cursor cur{data.c_str(), data.c_str() + data.size()};

  float curX = 0, curY = 0;      // current point
  float startX = 0, startY = 0;  // subpath start
  float ctrlX = 0, ctrlY = 0;    // last control point (for S/T reflection)
  char prevCmd = 0;
  char cmd = 0;

  while (true) {
    cur.skipSep();
    if (cur.p >= cur.end) {
      break;
    }
    char c = *cur.p;
    if (std::isalpha(static_cast<unsigned char>(c))) {
      cmd = c;
      cur.p++;
    } else {
      // Implicit repeat of previous command (M->L, m->l).
      if (cmd == 'M') {
        cmd = 'L';
      } else if (cmd == 'm') {
        cmd = 'l';
      }
    }

    bool relative = std::islower(static_cast<unsigned char>(cmd)) != 0;
    switch (std::toupper(static_cast<unsigned char>(cmd))) {
      case 'M': {
        float x = cur.number();
        float y = cur.number();
        if (relative) {
          x += curX;
          y += curY;
        }
        curX = x;
        curY = y;
        startX = x;
        startY = y;
        path.moveTo(x, y);
        break;
      }
      case 'L': {
        float x = cur.number();
        float y = cur.number();
        if (relative) {
          x += curX;
          y += curY;
        }
        curX = x;
        curY = y;
        path.lineTo(x, y);
        break;
      }
      case 'H': {
        float x = cur.number();
        if (relative) {
          x += curX;
        }
        curX = x;
        path.lineTo(curX, curY);
        break;
      }
      case 'V': {
        float y = cur.number();
        if (relative) {
          y += curY;
        }
        curY = y;
        path.lineTo(curX, curY);
        break;
      }
      case 'C': {
        float x1 = cur.number(), y1 = cur.number();
        float x2 = cur.number(), y2 = cur.number();
        float x = cur.number(), y = cur.number();
        if (relative) {
          x1 += curX; y1 += curY;
          x2 += curX; y2 += curY;
          x += curX; y += curY;
        }
        path.cubicTo(x1, y1, x2, y2, x, y);
        ctrlX = x2;
        ctrlY = y2;
        curX = x;
        curY = y;
        break;
      }
      case 'S': {
        float x2 = cur.number(), y2 = cur.number();
        float x = cur.number(), y = cur.number();
        if (relative) {
          x2 += curX; y2 += curY;
          x += curX; y += curY;
        }
        float x1 = curX, y1 = curY;
        char up = static_cast<char>(std::toupper(static_cast<unsigned char>(prevCmd)));
        if (up == 'C' || up == 'S') {
          x1 = 2 * curX - ctrlX;
          y1 = 2 * curY - ctrlY;
        }
        path.cubicTo(x1, y1, x2, y2, x, y);
        ctrlX = x2;
        ctrlY = y2;
        curX = x;
        curY = y;
        break;
      }
      case 'Q': {
        float x1 = cur.number(), y1 = cur.number();
        float x = cur.number(), y = cur.number();
        if (relative) {
          x1 += curX; y1 += curY;
          x += curX; y += curY;
        }
        path.quadTo(x1, y1, x, y);
        ctrlX = x1;
        ctrlY = y1;
        curX = x;
        curY = y;
        break;
      }
      case 'T': {
        float x = cur.number(), y = cur.number();
        if (relative) {
          x += curX; y += curY;
        }
        float x1 = curX, y1 = curY;
        char up = static_cast<char>(std::toupper(static_cast<unsigned char>(prevCmd)));
        if (up == 'Q' || up == 'T') {
          x1 = 2 * curX - ctrlX;
          y1 = 2 * curY - ctrlY;
        }
        path.quadTo(x1, y1, x, y);
        ctrlX = x1;
        ctrlY = y1;
        curX = x;
        curY = y;
        break;
      }
      case 'A': {
        // Skip rx, ry, xAxisRotation, largeArc, sweep; approximate to endpoint.
        cur.number(); cur.number(); cur.number();
        cur.number(); cur.number();
        float x = cur.number(), y = cur.number();
        if (relative) {
          x += curX; y += curY;
        }
        path.lineTo(x, y);
        curX = x;
        curY = y;
        break;
      }
      case 'Z': {
        path.close();
        curX = startX;
        curY = startY;
        break;
      }
      default:
        // Unknown command — bail out to avoid an infinite loop.
        cur.p = cur.end;
        break;
    }
    prevCmd = cmd;
  }
  return path;
}

}  // namespace tgfxrn
