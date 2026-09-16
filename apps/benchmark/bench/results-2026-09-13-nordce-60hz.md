# tgfx vs skia bench (complete)

| engine · scene | Present FPS | UI FPS | JS FPS | CPU % (1 core = 100) | PSS MB | ticks |
|---|---|---|---|---|---|---|
| tgfx · shapes | 28.3 | 59 | 58 | 151 | 304.1 | 20 |
| tgfx · images | 57.0 | 59 | 58 | 100 | 275.1 | 24 |
| tgfx · shader | 30.3 | 58 | 58 | 42 | 273.0 | 24 |
| tgfx · pattern | 57.0 | 58 | 58 | 61 | 273.7 | 24 |
| tgfx · paths | 57.9 | 59 | 59 | 101 | 291.2 | 24 |
| tgfx · text | 55.2 | 59 | 59 | 196 | 315.9 | 24 |
| skia · shapes | 25.9 | 27 | 14 | 105 | 397.7 | 24 |
| skia · images | 56.6 | 57 | 42 | 98 | 374.2 | 24 |
| skia · shader | 30.5 | 30 | 16 | 29 | 333.7 | 24 |
| skia · pattern | 57.0 | 58 | 58 | 47 | 333.9 | 24 |
| skia · paths | 57.9 | 58 | 49 | 87 | 336.9 | 24 |
| skia · text | 33.8 | 34 | 18 | 107 | 403.7 | 24 |
