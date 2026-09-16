# tgfx vs skia bench (complete)

| engine · scene | Present FPS | UI FPS | JS FPS | CPU % (1 core = 100) | PSS MB | ticks |
|---|---|---|---|---|---|---|
| tgfx · shapes | 63.9 | 91 | 90 | 192 | 390.1 | 25 |
| tgfx · images | 89.9 | 90 | 90 | 84 | 362.6 | 24 |
| tgfx · shader | 15.1 | 91 | 91 | 23 | 348.3 | 24 |
| tgfx · pattern | 90.1 | 91 | 91 | 43 | 344.7 | 24 |
| tgfx · paths | 89.9 | 91 | 91 | 71 | 368.7 | 24 |
| tgfx · text | 70.6 | 91 | 90 | 129 | 385.3 | 24 |
| skia · shapes | 27.6 | 28 | 15 | 104 | 453.4 | 24 |
| skia · images | 82.5 | 85 | 52 | 97 | 422.5 | 24 |
| skia · shader | 15.0 | 15 | 8 | 13 | 392.7 | 23 |
| skia · pattern | 90.1 | 91 | 90 | 50 | 389.2 | 24 |
| skia · paths | 90.3 | 91 | 88 | 79 | 427.6 | 24 |
| skia · text | 34.4 | 36 | 19 | 105 | 485.4 | 24 |
