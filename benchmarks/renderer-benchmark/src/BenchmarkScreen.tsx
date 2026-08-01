import React, { useCallback, useMemo, useRef, useState } from 'react'
import {
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { benchmarkMetrics } from './nativeMetrics'
import { buildScene, summarizeFrames } from './scene'
import { getSkiaBackendProof, SkiaRenderer } from './renderers/SkiaRenderer'
import { TgfxRenderer } from './renderers/TgfxRenderer'
import { ThorRenderer } from './renderers/ThorRenderer'
import type {
  BenchmarkConfig,
  BenchmarkResult,
  RendererId,
  Shape,
} from './types'

const renderers: { id: RendererId; label: string }[] = [
  { id: 'skia-graphite', label: 'Skia Graphite' },
  { id: 'thor-cpu', label: 'Thor CPU' },
  { id: 'thor-gpu', label: 'Thor GPU' },
  { id: 'tgfx', label: 'Tgfx GPU' },
]

const defaultConfig: BenchmarkConfig = {
  renderer: 'skia-graphite',
  objectCount: 3200,
  mainThreadPressureMs: 15,
  warmupSeconds: 5,
  durationSeconds: 15,
  seed: 20260729,
}

type Stage = 'config' | 'warmup' | 'measure' | 'stopping' | 'result' | 'frozen'

function Option<T extends string | number>({
  label,
  value,
  selected,
  onPress,
  testID,
}: {
  label: string
  value: T
  selected: boolean
  onPress: (value: T) => void
  testID: string
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      testID={testID}
      onPress={() => onPress(value)}
      style={[styles.option, selected && styles.optionSelected]}
    >
      <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
        {label}
      </Text>
    </Pressable>
  )
}

function backendProof(renderer: RendererId): Record<string, string | number | boolean> {
  if (renderer === 'skia-graphite') {
    return getSkiaBackendProof()
  }
  if (renderer === 'thor-cpu') {
    return { requestedBackend: 'cpu', engine: 'ThorVG SwCanvas' }
  }
  if (renderer === 'thor-gpu') {
    return { requestedBackend: 'gpu', engine: 'ThorVG GlCanvas GLES3' }
  }
  return { requestedBackend: 'gpu', engine: 'TGFX OpenGL ES' }
}

function Renderer({
  config,
  width,
  height,
  shapes,
}: {
  config: BenchmarkConfig
  width: number
  height: number
  shapes: Shape[]
}): React.JSX.Element {
  if (config.renderer === 'skia-graphite') {
    return <SkiaRenderer width={width} height={height} shapes={shapes} />
  }
  if (config.renderer === 'tgfx') {
    return <TgfxRenderer width={width} height={height} shapes={shapes} />
  }
  return (
    <ThorRenderer
      renderer={config.renderer}
      width={width}
      height={height}
      shapes={shapes}
    />
  )
}

export function BenchmarkScreen(): React.JSX.Element {
  const window = useWindowDimensions()
  const [config, setConfig] = useState(defaultConfig)
  const [stage, setStage] = useState<Stage>('config')
  const [phase, setPhase] = useState(0)
  const [result, setResult] = useState<BenchmarkResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const stageRef = useRef<Stage>('config')
  const animationRef = useRef<number | null>(null)
  const benchmarkStartRef = useRef(0)
  const measurementStartRef = useRef(0)
  const jsTimestampsRef = useRef<number[]>([])

  const width = Math.round(window.width)
  const height = Math.round(window.height)
  const shapes = useMemo(
    () => buildScene(config.objectCount, config.seed, width, height, phase),
    [config.objectCount, config.seed, height, phase, width]
  )

  const setStageValue = useCallback((value: Stage) => {
    stageRef.current = value
    setStage(value)
  }, [])

  const animate = useCallback((timestamp: number) => {
    if (stageRef.current === 'config' || stageRef.current === 'result') {
      return
    }
    if (benchmarkStartRef.current === 0) {
      benchmarkStartRef.current = timestamp
    }
    if (stageRef.current === 'measure') {
      jsTimestampsRef.current.push(timestamp)
    }
    setPhase((timestamp - benchmarkStartRef.current) / 1000)
    animationRef.current = requestAnimationFrame(animate)
  }, [])

  const complete = useCallback(async () => {
    try {
      stageRef.current = 'stopping'
      const native = await benchmarkMetrics.stop()
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current)
      }
      const completedAtEpochMs = Date.now()
      const firstJsFrame = jsTimestampsRef.current[0] ?? 0
      const lastJsFrame = jsTimestampsRef.current.at(-1) ?? firstJsFrame
      const js = summarizeFrames(
        jsTimestampsRef.current,
        lastJsFrame - firstJsFrame,
        native.device.refreshRateHz
      )
      const nextResult: BenchmarkResult = {
        schemaVersion: 1,
        config,
        backendProof: backendProof(config.renderer),
        viewport: { width, height },
        js,
        native,
        startedAtEpochMs: measurementStartRef.current,
        completedAtEpochMs,
      }
      const serialized = JSON.stringify(nextResult)
      benchmarkMetrics.publish(serialized)
      setResult(nextResult)
      setStage('result')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setStageValue('config')
    }
  }, [config, height, setStageValue, width])

  const start = useCallback(() => {
    if (stageRef.current !== 'config') {
      return
    }
    if (config.renderer === 'skia-graphite' && !getSkiaBackendProof().graphiteEnabled) {
      setError('Graphite runtime device is unavailable')
      return
    }
    setError(null)
    setResult(null)
    setPhase(0)
    jsTimestampsRef.current = []
    benchmarkStartRef.current = 0
    setStageValue('warmup')
    animationRef.current = requestAnimationFrame(animate)

    setTimeout(async () => {
      try {
        const nativeStart = await benchmarkMetrics.start(config.mainThreadPressureMs)
        measurementStartRef.current = nativeStart.startEpochMs
        jsTimestampsRef.current = []
        setStageValue('measure')
        setTimeout(complete, config.durationSeconds * 1000)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught))
        setStageValue('config')
      }
    }, config.warmupSeconds * 1000)
  }, [
    animate,
    complete,
    config.durationSeconds,
    config.mainThreadPressureMs,
    config.renderer,
    config.warmupSeconds,
    setStageValue,
  ])

  if (stage === 'warmup' || stage === 'measure' || stage === 'frozen') {
    return (
      <View style={styles.benchmark}>
        <StatusBar hidden />
        <Renderer config={config} width={width} height={height} shapes={shapes} />
      </View>
    )
  }

  if (stage === 'result' && result !== null) {
    return (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.screen}
      >
        <StatusBar hidden={false} barStyle="light-content" backgroundColor="#090d18" />
        <Text accessibilityRole="header" style={styles.title}>
          Benchmark complete
        </Text>
        <Text style={styles.subtitle}>
          {renderers.find((item) => item.id === result.config.renderer)?.label} ·{' '}
          {result.config.objectCount} objects · {result.config.mainThreadPressureMs}ms
          main pressure
        </Text>
        <View style={styles.resultGrid}>
          <Text style={styles.metric}>JS FPS {result.js.fps.toFixed(2)}</Text>
          <Text style={styles.metric}>
            Main FPS {result.native.mainThread.fps.toFixed(2)}
          </Text>
          <Text style={styles.metric}>
            CPU {result.native.processCpuPercent.toFixed(1)}%
          </Text>
          <Text style={styles.metric}>
            Peak PSS {(result.native.memory.peakPssKb / 1024).toFixed(1)} MB
          </Text>
          <Text style={styles.metric}>JS p99 {result.js.p99Ms.toFixed(2)} ms</Text>
          <Text style={styles.metric}>
            Main p99 {result.native.mainThread.p99Ms.toFixed(2)} ms
          </Text>
          <Text style={styles.metric}>
            Main missed {result.native.mainThread.missedFrames}
          </Text>
        </View>
        <Text selectable testID="benchmark-result-json" style={styles.json}>
          {JSON.stringify(result, null, 2)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Run again"
          testID="run-again"
          onPress={() => setStageValue('config')}
          style={styles.start}
        >
          <Text style={styles.startText}>Run again</Text>
        </Pressable>
      </ScrollView>
    )
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.screen}
    >
      <StatusBar barStyle="light-content" backgroundColor="#090d18" />
      <Text accessibilityRole="header" style={styles.title}>
        Renderer stress benchmark
      </Text>
      <Text style={styles.subtitle}>
        HARD PRESET · 3,200 objects · 15ms main pressure per vsync
      </Text>

      <Text style={styles.label}>Renderer</Text>
      <View style={styles.options}>
        {renderers.map((item) => (
          <Option
            key={item.id}
            label={item.label}
            value={item.id}
            selected={config.renderer === item.id}
            onPress={(renderer) => setConfig((current) => ({ ...current, renderer }))}
            testID={`renderer-${item.id}`}
          />
        ))}
      </View>

      <Text style={styles.label}>Logical objects</Text>
      <View style={styles.options}>
        {[400, 1600, 3200, 6400].map((value) => (
          <Option
            key={value}
            label={String(value)}
            value={value}
            selected={config.objectCount === value}
            onPress={(objectCount) =>
              setConfig((current) => ({ ...current, objectCount }))
            }
            testID={`objects-${value}`}
          />
        ))}
      </View>

      <Text style={styles.label}>Main-thread pressure per vsync</Text>
      <View style={styles.options}>
        {[0, 8, 12, 15].map((value) => (
          <Option
            key={value}
            label={value === 0 ? 'Off' : `${value}ms`}
            value={value}
            selected={config.mainThreadPressureMs === value}
            onPress={(mainThreadPressureMs) =>
              setConfig((current) => ({ ...current, mainThreadPressureMs }))
            }
            testID={`main-pressure-${value}`}
          />
        ))}
      </View>

      <Text style={styles.label}>Warmup</Text>
      <View style={styles.options}>
        {[5, 10, 20].map((value) => (
          <Option
            key={value}
            label={`${value}s`}
            value={value}
            selected={config.warmupSeconds === value}
            onPress={(warmupSeconds) =>
              setConfig((current) => ({ ...current, warmupSeconds }))
            }
            testID={`warmup-${value}`}
          />
        ))}
      </View>

      <Text style={styles.label}>Measured duration</Text>
      <View style={styles.options}>
        {[15, 30, 60].map((value) => (
          <Option
            key={value}
            label={`${value}s`}
            value={value}
            selected={config.durationSeconds === value}
            onPress={(durationSeconds) =>
              setConfig((current) => ({ ...current, durationSeconds }))
            }
            testID={`duration-${value}`}
          />
        ))}
      </View>

      <Text style={styles.label}>Seed</Text>
      <View style={styles.options}>
        {[1337, 20260729].map((value) => (
          <Option
            key={value}
            label={String(value)}
            value={value}
            selected={config.seed === value}
            onPress={(seed) => setConfig((current) => ({ ...current, seed }))}
            testID={`seed-${value}`}
          />
        ))}
      </View>

      {error !== null ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Start benchmark"
        testID="start-benchmark"
        onPress={start}
        style={styles.start}
      >
        <Text style={styles.startText}>Start benchmark</Text>
      </Pressable>
      {/* Renders phase 0 without animating, so a screenshot is a deterministic
          pixel reference for cross-renderer and before/after comparison. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Freeze frame"
        testID="freeze-frame"
        onPress={() => {
          setPhase(0)
          setStageValue('frozen')
        }}
        style={styles.start}
      >
        <Text style={styles.startText}>Freeze frame</Text>
      </Pressable>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  benchmark: {
    flex: 1,
    backgroundColor: '#05070d',
  },
  screen: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingVertical: 28,
    backgroundColor: '#090d18',
  },
  title: {
    color: '#f8fafc',
    fontSize: 28,
    fontWeight: '800',
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 24,
  },
  label: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 14,
    textTransform: 'uppercase',
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  option: {
    borderColor: '#334155',
    borderRadius: 9,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  optionSelected: {
    backgroundColor: '#2563eb',
    borderColor: '#60a5fa',
  },
  optionText: {
    color: '#cbd5e1',
    fontSize: 14,
    fontWeight: '600',
  },
  optionTextSelected: {
    color: '#ffffff',
  },
  start: {
    alignItems: 'center',
    backgroundColor: '#16a34a',
    borderRadius: 10,
    marginTop: 28,
    paddingVertical: 15,
  },
  startText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  error: {
    color: '#fca5a5',
    marginTop: 16,
  },
  resultGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metric: {
    backgroundColor: '#172033',
    borderRadius: 8,
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '700',
    padding: 10,
    width: '48%',
  },
  json: {
    backgroundColor: '#05070d',
    borderRadius: 8,
    color: '#94a3b8',
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 20,
    padding: 12,
  },
})
