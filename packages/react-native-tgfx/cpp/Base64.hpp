// Minimal base64 decoder used to turn `<Image image={base64}>` payloads into
// raw encoded image bytes for tgfx::Image::MakeFromEncoded.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace tgfxrn {

inline std::vector<uint8_t> base64Decode(const std::string& input) {
  static int8_t table[256];
  static bool initialized = false;
  if (!initialized) {
    for (int i = 0; i < 256; i++) {
      table[i] = -1;
    }
    const char* chars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (int i = 0; i < 64; i++) {
      table[static_cast<uint8_t>(chars[i])] = static_cast<int8_t>(i);
    }
    initialized = true;
  }

  std::vector<uint8_t> out;
  out.reserve(input.size() * 3 / 4);
  int32_t buffer = 0;
  int bits = 0;
  for (char ch : input) {
    if (ch == '=' || ch == '\n' || ch == '\r' || ch == ' ') {
      continue;
    }
    int8_t value = table[static_cast<uint8_t>(ch)];
    if (value < 0) {
      continue;
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push_back(static_cast<uint8_t>((buffer >> bits) & 0xff));
    }
  }
  return out;
}

}  // namespace tgfxrn
