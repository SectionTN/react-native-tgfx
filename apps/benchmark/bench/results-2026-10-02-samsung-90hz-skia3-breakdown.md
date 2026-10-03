# tgfx vs skia bench (complete)

| engine · scene | Present FPS | UI FPS | JS FPS | CPU % (1 core = 100) | PSS MB | ticks |
|---|---|---|---|---|---|---|
| tgfx · shapes | 60.8 | 91 | 90 | 183 | 444.3 | 52 |
| skia · shapes | 18.8 | 86 | 85 | 95 | 504.9 | 51 |
| graphite · shapes | 21.9 | 88 | 86 | 94 | 515.0 | 51 |
| tgfx · images | 90.1 | 91 | 91 | 123 | 454.4 | 51 |
| skia · images | 45.1 | 91 | 90 | 92 | 441.8 | 51 |
| graphite · images | 44.1 | 91 | 91 | 91 | 447.6 | 51 |
| tgfx · shader | 15.1 | 91 | 91 | 25 | 450.7 | 51 |
| skia · shader | 15.0 | 30 | 30 | 17 | 419.1 | 51 |
| graphite · shader | 15.1 | 30 | 30 | 17 | 405.7 | 51 |
| tgfx · pattern | 90.3 | 91 | 91 | 58 | 425.9 | 51 |
| skia · pattern | 89.9 | 91 | 91 | 67 | 401.4 | 51 |
| graphite · pattern | 89.5 | 91 | 91 | 65 | 404.7 | 51 |
| tgfx · paths | 90.0 | 91 | 91 | 83 | 438.4 | 51 |
| skia · paths | 79.4 | 91 | 91 | 86 | 415.6 | 51 |
| graphite · paths | 82.6 | 91 | 91 | 86 | 414.4 | 51 |
| tgfx · text | 66.3 | 91 | 91 | 153 | 456.3 | 51 |
| skia · text | 25.7 | 91 | 91 | 100 | 490.7 | 51 |
| graphite · text | 25.8 | 91 | 91 | 100 | 491.1 | 51 |

## Where the CPU and memory go

| engine · scene | UI thread % | JS thread % | busiest other threads % | Graphics MB | Native MB | Java MB |
|---|---|---|---|---|---|---|
| tgfx · shapes | 6 | 3 | TgfxRender 160, nitro-thread 24, binder 7 | 180.9 | 155.8 | 4.4 |
| skia · shapes | 29 | 3 | RNSkia Render 55, binder 5, mali-cmar-backe 5 | 233.7 | 155.6 | 4.5 |
| graphite · shapes | 27 | 2 | RNSkia Render 54, mali-cmar-backe 5, binder 5 | 240.8 | 154.8 | 4.5 |
| tgfx · images | 9 | 3 | TgfxRender 79, nitro-thread 10, mali-cmar-backe 9 | 198.6 | 142.7 | 4.5 |
| skia · images | 38 | 3 | RNSkia Render 38, binder 6, mali-cmar-backe 6 | 185.3 | 139.8 | 4.6 |
| graphite · images | 38 | 3 | RNSkia Render 37, binder 7, mali-cmar-backe 6 | 191.1 | 140.6 | 4.6 |
| tgfx · shader | 12 | 3 | binder 4, TgfxRender 4, mali-cmar-backe 1 | 191.2 | 134.3 | 4.5 |
| skia · shader | 9 | 1 | binder 4, mali-cmar-backe 1, RNSkia Render 1 | 159.6 | 132.4 | 4.5 |
| graphite · shader | 8 | 1 | binder 4, mali-cmar-backe 2, RNSkia Render 1 | 148.8 | 130.2 | 4.5 |
| tgfx · pattern | 11 | 3 | TgfxRender 21, mali-cmar-backe 9, binder 9 | 168.4 | 129.5 | 4.5 |
| skia · pattern | 31 | 3 | binder 10, mali-cmar-backe 10, RNSkia Render 10 | 146.3 | 132.0 | 4.8 |
| graphite · pattern | 30 | 3 | binder 11, mali-cmar-backe 10, RNSkia Render 9 | 146.8 | 130.5 | 4.8 |
| tgfx · paths | 7 | 3 | TgfxRender 55, binder 9, mali-cmar-backe 5 | 182.6 | 138.4 | 4.5 |
| skia · paths | 27 | 3 | RNSkia Render 34, binder 10, mali-cmar-backe 8 | 158.5 | 138.1 | 4.8 |
| graphite · paths | 28 | 3 | RNSkia Render 34, binder 10, mali-cmar-backe 8 | 158.8 | 135.9 | 4.8 |
| tgfx · text | 5 | 3 | TgfxRender 124, nitro-thread 10, binder 7 | 178.8 | 158.3 | 4.5 |
| skia · text | 21 | 2 | RNSkia Render 68, binder 5, mali-cmar-backe 4 | 200.3 | 164.7 | 4.6 |
| graphite · text | 21 | 2 | RNSkia Render 68, binder 4, mali-cmar-backe 4 | 203.0 | 162.9 | 4.6 |
