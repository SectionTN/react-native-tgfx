# tgfx vs skia bench (complete)

| engine · scene | Present FPS | UI FPS | JS FPS | CPU % (1 core = 100) | PSS MB | thermal | ticks |
|---|---|---|---|---|---|---|---|
| tgfx · paths | 90.1 | 91 | 91 | 63 | 340.3 | 0 | 25 |
| skia · paths | 17.8 | 91 | 91 | 40 | 452.8 | 0 | 24 |
| tgfx · shader | 15.1 | 91 | 91 | 24 | 461.6 | 0 | 24 |
| skia · shader | 9.3 | 91 | 91 | 25 | 441.2 | 0 | 24 |

`thermal` is the highest Android thermal status (0 none … 3 severe) seen at the start of the combo's runs.

## Where the CPU and memory go

| engine · scene | UI thread % | JS thread % | busiest other threads % | Graphics MB | Native MB | Java MB |
|---|---|---|---|---|---|---|
| tgfx · paths | 7 | 1 | TgfxRender 56, binder 5, mali-cmar-backe 5 | 146.8 | 112.3 | 3.4 |
| skia · paths | 12 | 3 | RNSkia Render 15, RNSkia Present 8, mali-cmar-backe 4 | 249.5 | 119.2 | 3.5 |
| tgfx · shader | 12 | 3 | binder 4, TgfxRender 4, mali-cmar-backe 1 | 260.6 | 117.4 | 3.5 |
| skia · shader | 12 | 3 | RNSkia Present 4, binder 3, mali-cmar-backe 1 | 239.4 | 118.0 | 3.5 |
