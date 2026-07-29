import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = resolve(root, 'artifacts')
const renderers = ['skia-graphite', 'thor-cpu', 'thor-gpu', 'tgfx']

function number(block, pattern) {
  const value = block.match(pattern)?.[1]
  return value === undefined ? null : Number(value)
}

function layers(raw) {
  return raw
    .split(/(?=displayRefreshRate = \d+ fps\nrenderRate = \d+ fps\nuid = )/)
    .map((block) => {
      const layerName = block.match(/layerName = (.+)/)?.[1]
      if (!layerName?.includes('com.rendererbenchmark')) {
        return null
      }
      return {
        layerName,
        totalFrames: number(block, /totalFrames = (\d+)/),
        droppedFrames: number(block, /droppedFrames = (\d+)/),
        lateAcquireFrames: number(block, /lateAcquireFrames = (\d+)/),
        badDesiredPresentFrames: number(block, /badDesiredPresentFrames = (\d+)/),
        timelineFrames: number(block, /totalTimelineFrames = (\d+)/),
        jankyFrames: number(block, /jankyFrames = (\d+)/),
        averageFps: number(block, /averageFPS = ([\d.]+)/),
      }
    })
    .filter(Boolean)
}

const summary = Object.fromEntries(
  renderers.map((renderer) => {
    const raw = readFileSync(
      resolve(artifacts, `surfaceflinger-${renderer}.txt`),
      'utf8'
    )
    return [
      renderer,
      {
        statsStartEpochSeconds: number(raw, /statsStart = (\d+)/),
        statsEndEpochSeconds: number(raw, /statsEnd = (\d+)/),
        displayOnTimeMs: number(raw, /displayOnTime = (\d+) ms/),
        globalMissedFrames: number(raw, /^missedFrames = (\d+)/m),
        layers: layers(raw),
      },
    ]
  })
)

writeFileSync(
  resolve(artifacts, 'presentation-summary.json'),
  `${JSON.stringify(summary, null, 2)}\n`
)

for (const [renderer, result] of Object.entries(summary)) {
  process.stdout.write(`${renderer}\n`)
  for (const layer of result.layers) {
    process.stdout.write(
      `  ${layer.layerName} | ${layer.totalFrames} frames | ${layer.averageFps?.toFixed(2)} fps | ${layer.droppedFrames} dropped | ${layer.jankyFrames}/${layer.timelineFrames} janky\n`
    )
  }
}
