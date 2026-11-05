# tgfx vs skia 3.8.1 - paths re-check, Samsung SM-E146B (90 Hz)

Samsung SM-E146B (Exynos 1330, Mali-G68), Android 15, refresh locked at 90 Hz. Release
build at 3e5157f, `react-native-skia@3.8.1`. `--scenes paths --order alternate --reps 3
--gap 30`. CPU clusters uncapped before and after, thermal status 0 at every combo start.
Parity stills checked.

Present FPS per rep: tgfx 90.1 / 90.3 / 90.3, skia 17.9 / 17.4 / 18.3.

CPU % here leaves out the `--gap` idle seconds (the runner dropped samples after the app's
`cool` line).


| engine · scene | Present FPS | UI FPS | JS FPS | CPU % (1 core = 100) | PSS MB | thermal | ticks |
|---|---|---|---|---|---|---|---|
| tgfx · paths | 90.3 | 91 | 91 | 83 | 479.5 | 0 | 79 |
| skia · paths | 17.9 | 91 | 91 | 47 | 458.0 | 0 | 78 |

`thermal` is the highest Android thermal status (0 none … 3 severe) seen at the start of the combo's runs.

## Where the CPU and memory go

| engine · scene | UI thread % | JS thread % | busiest other threads % | Graphics MB | Native MB | Java MB |
|---|---|---|---|---|---|---|
| tgfx · paths | 7 | 3 | TgfxRender 56, binder 9, mali-cmar-backe 5 | 265.1 | 120.9 | 4.5 |
| skia · paths | 12 | 3 | RNSkia Render 15, RNSkia Present 9, binder 5 | 250.5 | 119.6 | 4.6 |
