# tgfx vs skia bench (complete)

| engine · scene | Present FPS | UI FPS | JS FPS | CPU % (1 core = 100) | PSS MB | ticks |
|---|---|---|---|---|---|---|
| tgfx · shapes | 61.6 | 91 | 90 | 198 | 391.6 | 25 |
| skia · shapes | 27.0 | 26 | 14 | 104 | 452.4 | 24 |
| tgfx · images | 89.9 | 91 | 91 | 83 | 422.0 | 24 |
| skia · images | 82.4 | 83 | 50 | 98 | 410.3 | 24 |
| tgfx · shader | 15.1 | 91 | 91 | 25 | 426.7 | 24 |
| skia · shader | 15.1 | 15 | 8 | 12 | 402.4 | 23 |
| tgfx · pattern | 90.1 | 91 | 91 | 48 | 423.8 | 24 |
| skia · pattern | 90.3 | 91 | 90 | 51 | 398.5 | 24 |
| tgfx · paths | 89.8 | 91 | 91 | 75 | 433.1 | 24 |
| skia · paths | 90.0 | 91 | 87 | 78 | 425.0 | 24 |
| tgfx · text | 70.5 | 91 | 90 | 129 | 471.8 | 24 |
| skia · text | 33.8 | 36 | 18 | 105 | 499.0 | 24 |
