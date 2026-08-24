#pragma once

#include <array>
#include <cstdint>
#include <string>
#include <vector>

namespace tgfxrn {

// constexpr, so the table is in .rodata: no runtime initialisation to race on.
inline constexpr std::array<int8_t, 256> kBase64Table = [] {
  std::array<int8_t, 256> table{};
  table.fill(-1);
  const char* chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (int i = 0; i < 64; i++) {
    table[static_cast<uint8_t>(chars[i])] = static_cast<int8_t>(i);
  }
  return table;
}();

static_assert(kBase64Table['A'] == 0 && kBase64Table['a'] == 26 &&
              kBase64Table['0'] == 52 && kBase64Table['/'] == 63 &&
              kBase64Table['%'] == -1 && kBase64Table[0] == -1);

inline std::vector<uint8_t> base64Decode(const std::string& input) {
  std::vector<uint8_t> out;
  out.reserve(input.size() * 3 / 4);
  int32_t buffer = 0;
  int bits = 0;
  for (char ch : input) {
    if (ch == '=' || ch == '\n' || ch == '\r' || ch == ' ') {
      continue;
    }
    int8_t value = kBase64Table[static_cast<uint8_t>(ch)];
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
