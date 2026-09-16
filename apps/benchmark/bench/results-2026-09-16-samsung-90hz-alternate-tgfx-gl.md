# tgfx vs skia bench (complete — logcat stream dropped during the last combo, all rows measured)

| engine · scene | Present FPS | UI FPS | JS FPS | CPU % (1 core = 100) | PSS MB | ticks |
|---|---|---|---|---|---|---|
| tgfx · shapes | 53.6 | 91 | 90 | 170 | 302.7 | 24 |
| skia · shapes | 19.5 | 20 | 10 | 104 | 313.6 | 24 |
| tgfx · images | 89.1 | 90 | 90 | 88 | 328.6 | 24 |
| skia · images | 61.5 | 70 | 38 | 104 | 308.8 | 24 |
| tgfx · shader | 15.6 | 91 | 91 | 27 | 308.7 | 24 |
| skia · shader | 15.0 | 15 | 8 | 12 | 284.3 | 23 |
| tgfx · pattern | 90.3 | 91 | 91 | 51 | 308.0 | 24 |
| skia · pattern | 90.3 | 91 | 89 | 48 | 279.2 | 24 |
| tgfx · paths | 90.4 | 91 | 91 | 77 | 357.4 | 24 |
| skia · paths | 90.4 | 91 | 87 | 79 | 306.2 | 24 |
| tgfx · text | 69.5 | 91 | 91 | 129 | 389.8 | 24 |
| skia · text | 34.3 | 31 | 16 | 10 | 338.5 | 27 |
