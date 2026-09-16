# tgfx vs skia bench (complete)

| engine · scene | Present FPS | UI FPS | JS FPS | CPU % (1 core = 100) | PSS MB | ticks |
|---|---|---|---|---|---|---|
| tgfx · shapes | 53.9 | 120 | 119 | 280 | 305.2 | 25 |
| tgfx · images | 118.9 | 120 | 119 | 170 | 280.9 | 24 |
| tgfx · shader | 20.5 | 119 | 119 | 28 | 281.5 | 24 |
| tgfx · pattern | 118.5 | 120 | 119 | 62 | 277.6 | 24 |
| tgfx · paths | 71.8 | 120 | 119 | 126 | 290.2 | 24 |
| tgfx · text | 44.9 | 120 | 119 | 232 | 372.6 | 24 |
| skia · shapes | 14.0 | 14 | 8 | 107 | 432.0 | 24 |
| skia · images | 59.0 | 63 | 32 | 109 | 422.7 | 24 |
| skia · shader | 20.6 | 20 | 11 | 18 | 421.3 | 24 |
| skia · pattern | 118.6 | 119 | 117 | 63 | 406.0 | 24 |
| skia · paths | 104.4 | 107 | 58 | 113 | 405.4 | 24 |
| skia · text | 19.5 | 19 | 11 | 106 | 427.0 | 24 |
