import { NativeModules } from 'react-native'
import type { NativeMetrics } from './types'

type BenchmarkMetricsModule = {
  start(mainThreadPressureMs: number): Promise<Record<string, number>>
  stop(): Promise<NativeMetrics>
  publish(result: string): void
}

export const benchmarkMetrics =
  NativeModules.BenchmarkMetrics as BenchmarkMetricsModule
