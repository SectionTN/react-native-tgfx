# tgfx vs skia bench (complete)

| engine · scene | Present FPS | UI FPS | JS FPS | CPU % (1 core = 100) | PSS MB | ticks |
|---|---|---|---|---|---|---|
| tgfx · shapes | 52.0 | 120 | 119 | 276 | 321.4 | 25 |
| tgfx · images | 118.6 | 120 | 119 | 164 | 296.7 | 24 |
| tgfx · shader | 20.5 | 120 | 119 | 29 | 297.5 | 24 |
| tgfx · pattern | 118.8 | 120 | 119 | 63 | 293.6 | 24 |
| tgfx · paths | 115.4 | 120 | 119 | 128 | 306.3 | 24 |
| tgfx · text | 42.8 | 120 | 119 | 233 | 324.9 | 24 |
| skia · shapes | 14.1 | 14 | 7 | 107 | 384.3 | 24 |
| skia · images | 57.9 | 63 | 32 | 109 | 374.6 | 24 |
| skia · shader | 20.6 | 20 | 11 | 19 | 373.2 | 24 |
| skia · pattern | 118.4 | 119 | 116 | 64 | 354.5 | 24 |
| skia · paths | 104.1 | 109 | 59 | 114 | 360.6 | 24 |
| skia · text | 19.3 | 19 | 10 | 106 | 383.1 | 24 |
