import Darwin
import Foundation
import React
import UIKit

/// iOS counterpart of `BenchmarkMetricsModule.kt`. Same contract, same metric
/// windows: a main-thread display link samples frame times while burning
/// `mainThreadPressureMs` of every vsync, and process CPU/memory are read from
/// the Mach task. Fields Android reports and iOS has no equivalent for (PSS,
/// Java heap, battery temperature) are reported as 0.
@objc(BenchmarkMetrics)
final class BenchmarkMetrics: NSObject {
  private var frameTimes: [CFTimeInterval] = []
  private var footprintSamples: [Double] = []
  private var displayLink: CADisplayLink?
  private var sampler: Timer?
  private var running = false
  private var startWall: CFTimeInterval = 0
  private var startCpuMs: Double = 0
  private var pressureSeconds: CFTimeInterval = 0

  @objc static func requiresMainQueueSetup() -> Bool { true }

  @objc func start(
    _ mainThreadPressureMs: Double,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      if self.running {
        reject("ALREADY_RUNNING", "Benchmark metrics are already running", nil)
        return
      }
      self.frameTimes.removeAll()
      self.footprintSamples = [self.memoryFootprintKb()]
      self.pressureSeconds = min(max(mainThreadPressureMs, 0), 16) / 1000
      self.startWall = CACurrentMediaTime()
      self.startCpuMs = self.processCpuMs()
      self.running = true

      let link = CADisplayLink(target: self, selector: #selector(self.onFrame))
      link.add(to: .main, forMode: .common)
      self.displayLink = link
      self.sampler = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in
        self.footprintSamples.append(self.memoryFootprintKb())
      }
      resolve([
        "startEpochMs": Date().timeIntervalSince1970 * 1000,
        "startMonotonicMs": self.startWall * 1000,
      ])
    }
  }

  @objc private func onFrame(_ link: CADisplayLink) {
    guard running else { return }
    frameTimes.append(link.timestamp)
    let deadline = CACurrentMediaTime() + pressureSeconds
    while CACurrentMediaTime() < deadline {}
  }

  @objc func stop(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      guard self.running else {
        reject("NOT_RUNNING", "Benchmark metrics are not running", nil)
        return
      }
      self.running = false
      self.displayLink?.invalidate()
      self.displayLink = nil
      self.sampler?.invalidate()
      self.sampler = nil

      let durationMs = (CACurrentMediaTime() - self.startWall) * 1000
      let cpuMs = self.processCpuMs() - self.startCpuMs
      let refreshRate = Double(UIScreen.main.maximumFramesPerSecond)
      let end = self.memoryFootprintKb()
      self.footprintSamples.append(end)
      let start = self.footprintSamples.first ?? end
      let peak = self.footprintSamples.max() ?? end

      resolve([
        "mainThread": self.frameStats(durationMs: durationMs, refreshRate: refreshRate),
        "processCpuPercent": durationMs > 0 ? cpuMs * 100 / durationMs : 0,
        "wallTimeMs": durationMs,
        "processCpuTimeMs": cpuMs,
        // iOS has no PSS; the Mach phys_footprint is the comparable number and
        // is reported in every PSS field so the shared schema still holds.
        "memory": [
          "startPssKb": start, "endPssKb": end, "peakPssKb": peak,
          "startNativeHeapKb": start, "endNativeHeapKb": end, "peakNativeHeapKb": peak,
          "startJavaHeapKb": 0, "endJavaHeapKb": 0, "peakJavaHeapKb": 0,
        ],
        "device": [
          "refreshRateHz": refreshRate,
          "thermalStatusStart": 0, "thermalStatusEnd": 0,
          "batteryTemperatureStartC": 0, "batteryTemperatureEndC": 0,
        ],
      ])
    }
  }

  @objc func publish(_ result: String) {
    // A file in the app container rather than a log line: the result JSON is a
    // few KB and the unified log truncates long messages.
    guard let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
    else { return }
    try? result.write(to: directory.appendingPathComponent("benchmark-result.json"),
                      atomically: true, encoding: .utf8)
  }

  private func frameStats(durationMs: Double, refreshRate: Double) -> [String: Any] {
    let intervals = zip(frameTimes.dropFirst(), frameTimes)
      .map { ($0 - $1) * 1000 }
      .sorted()
    let budget = 1000 / refreshRate
    let missed = intervals.reduce(0) { $0 + max(0, Int((($1 / budget).rounded())) - 1) }
    func percentile(_ q: Double) -> Double {
      guard !intervals.isEmpty else { return 0 }
      let index = min(intervals.count - 1, max(0, Int((Double(intervals.count) * q).rounded(.up)) - 1))
      return intervals[index]
    }
    return [
      "fps": durationMs > 0 ? Double(frameTimes.count) * 1000 / durationMs : 0,
      "frameCount": frameTimes.count,
      "missedFrames": missed,
      "p50Ms": percentile(0.50),
      "p90Ms": percentile(0.90),
      "p95Ms": percentile(0.95),
      "p99Ms": percentile(0.99),
      "maxMs": intervals.last ?? 0,
    ]
  }

  /// Summed CPU time of every thread in this task, in milliseconds.
  private func processCpuMs() -> Double {
    var info = task_thread_times_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_thread_times_info_data_t>.size / MemoryLayout<natural_t>.size)
    let live = withUnsafeMutablePointer(to: &info) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        task_info(mach_task_self_, task_flavor_t(TASK_THREAD_TIMES_INFO), $0, &count)
      }
    }
    var terminated = task_basic_info_data_t()
    var basicCount = mach_msg_type_number_t(MemoryLayout<task_basic_info_data_t>.size / MemoryLayout<natural_t>.size)
    let dead = withUnsafeMutablePointer(to: &terminated) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(basicCount)) {
        task_info(mach_task_self_, task_flavor_t(TASK_BASIC_INFO), $0, &basicCount)
      }
    }
    func ms(_ t: time_value_t) -> Double { Double(t.seconds) * 1000 + Double(t.microseconds) / 1000 }
    var total: Double = 0
    if live == KERN_SUCCESS { total += ms(info.user_time) + ms(info.system_time) }
    if dead == KERN_SUCCESS { total += ms(terminated.user_time) + ms(terminated.system_time) }
    return total
  }

  private func memoryFootprintKb() -> Double {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
    let result = withUnsafeMutablePointer(to: &info) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
      }
    }
    return result == KERN_SUCCESS ? Double(info.phys_footprint) / 1024 : 0
  }
}
