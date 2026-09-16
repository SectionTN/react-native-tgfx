# tgfx vs skia bench (complete)

| engine · scene | Present FPS | UI FPS | JS FPS | CPU % (1 core = 100) | PSS MB | ticks |
|---|---|---|---|---|---|---|
| tgfx · shapes | 51.9 | 119 | 119 | 279 | 306.1 | 25 |
| tgfx · images | 118.8 | 120 | 119 | 169 | 280.3 | 24 |
| tgfx · shader | 20.6 | 119 | 119 | 28 | 280.5 | 23 |
| tgfx · pattern | 118.5 | 120 | 119 | 61 | 279.8 | 24 |
| tgfx · paths | 114.1 | 120 | 119 | 127 | 292.6 | 24 |
| tgfx · text | 43.1 | 120 | 119 | 233 | 376.6 | 24 |
| skia · shapes | 13.8 | 14 | 7 | 107 | 432.6 | 24 |
| skia · images | 58.6 | 63 | 32 | 110 | 413.2 | 24 |
| skia · shader | 20.6 | 20 | 11 | 18 | 411.8 | 24 |
| skia · pattern | 118.6 | 119 | 117 | 63 | 409.7 | 24 |
| skia · paths | 104.0 | 107 | 58 | 113 | 407.9 | 24 |
| skia · text | 19.3 | 19 | 10 | 106 | 430.2 | 24 |
