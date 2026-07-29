package com.rendererbenchmark

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Debug
import android.os.Handler
import android.os.HandlerThread
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
import android.util.Log
import android.view.Choreographer
import android.view.WindowManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import java.util.Collections
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.round

class BenchmarkMetricsModule(
  private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context) {
  private data class MemorySample(
    val pssKb: Long,
    val nativeHeapKb: Long,
    val javaHeapKb: Long,
  )

  private val frameTimes = ArrayList<Long>()
  private val memorySamples = Collections.synchronizedList(ArrayList<MemorySample>())
  private var samplerThread: HandlerThread? = null
  private var samplerHandler: Handler? = null
  @Volatile private var running = false
  private var startWallNs = 0L
  private var startCpuMs = 0L
  private var thermalStatusStart = 0
  private var batteryTemperatureStartC = 0.0
  private var runGeneration = 0
  private var mainThreadPressureNs = 0L

  private val frameCallback = object : Choreographer.FrameCallback {
    override fun doFrame(frameTimeNanos: Long) {
      if (!running) {
        return
      }
      frameTimes.add(frameTimeNanos)
      val pressureDeadline = SystemClock.elapsedRealtimeNanos() + mainThreadPressureNs
      while (SystemClock.elapsedRealtimeNanos() < pressureDeadline) {
      }
      Choreographer.getInstance().postFrameCallback(this)
    }
  }

  override fun getName() = "BenchmarkMetrics"

  @ReactMethod
  fun start(mainThreadPressureMs: Double, promise: Promise) {
    UiThreadUtil.runOnUiThread {
      if (running) {
        promise.reject("ALREADY_RUNNING", "Benchmark metrics are already running")
        return@runOnUiThread
      }

      frameTimes.clear()
      memorySamples.clear()
      memorySamples.add(readMemory())
      thermalStatusStart = thermalStatus()
      batteryTemperatureStartC = batteryTemperature()
      mainThreadPressureNs = (mainThreadPressureMs.coerceIn(0.0, 16.0) * 1_000_000).toLong()
      runGeneration += 1
      val generation = runGeneration
      samplerThread = HandlerThread("BenchmarkSampler").also { it.start() }
      samplerHandler = Handler(samplerThread!!.looper)
      startWallNs = SystemClock.elapsedRealtimeNanos()
      startCpuMs = Process.getElapsedCpuTime()
      running = true
      samplerHandler?.post(object : Runnable {
        override fun run() {
          if (!running || generation != runGeneration) {
            return
          }
          val sample = readMemory()
          if (!running || generation != runGeneration) {
            return
          }
          memorySamples.add(sample)
          samplerHandler?.postDelayed(this, 500)
        }
      })
      Choreographer.getInstance().postFrameCallback(frameCallback)
      promise.resolve(Arguments.createMap().apply {
        putDouble("startEpochMs", System.currentTimeMillis().toDouble())
        putDouble("startMonotonicMs", startWallNs / 1_000_000.0)
      })
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    if (!running) {
      promise.reject("NOT_RUNNING", "Benchmark metrics are not running")
      return
    }

    UiThreadUtil.runOnUiThread {
      val stopWallNs = SystemClock.elapsedRealtimeNanos()
      val stopCpuMs = Process.getElapsedCpuTime()
      running = false
      Choreographer.getInstance().removeFrameCallback(frameCallback)
      samplerHandler?.removeCallbacksAndMessages(null)
      samplerThread?.quitSafely()

      val endMemory = readMemory()
      memorySamples.add(endMemory)
      val durationMs = (stopWallNs - startWallNs) / 1_000_000.0
      val cpuTimeMs = (stopCpuMs - startCpuMs).toDouble()
      val refreshRate = refreshRate()

      val result = Arguments.createMap().apply {
        putMap("mainThread", frameStats(frameTimes.toList(), durationMs, refreshRate))
        putDouble("processCpuPercent", if (durationMs > 0) cpuTimeMs * 100 / durationMs else 0.0)
        putDouble("wallTimeMs", durationMs)
        putDouble("processCpuTimeMs", cpuTimeMs)
        putMap("memory", memoryResult(endMemory))
        putMap("device", Arguments.createMap().apply {
          putDouble("refreshRateHz", refreshRate)
          putInt("thermalStatusStart", thermalStatusStart)
          putInt("thermalStatusEnd", thermalStatus())
          putDouble("batteryTemperatureStartC", batteryTemperatureStartC)
          putDouble("batteryTemperatureEndC", batteryTemperature())
        })
      }
      promise.resolve(result)
    }
  }

  @ReactMethod
  fun publish(result: String) {
    Log.i("RendererBenchmark", result)
  }

  private fun readMemory(): MemorySample {
    val runtime = Runtime.getRuntime()
    return MemorySample(
      pssKb = Debug.getPss(),
      nativeHeapKb = Debug.getNativeHeapAllocatedSize() / 1024,
      javaHeapKb = (runtime.totalMemory() - runtime.freeMemory()) / 1024,
    )
  }

  private fun memoryResult(endMemory: MemorySample) = Arguments.createMap().apply {
    val samples = synchronized(memorySamples) { memorySamples.toList() }
    val startMemory = samples.firstOrNull() ?: endMemory
    putDouble("startPssKb", startMemory.pssKb.toDouble())
    putDouble("endPssKb", endMemory.pssKb.toDouble())
    putDouble(
      "peakPssKb",
      (samples.maxOfOrNull { it.pssKb } ?: endMemory.pssKb).toDouble(),
    )
    putDouble("startNativeHeapKb", startMemory.nativeHeapKb.toDouble())
    putDouble("endNativeHeapKb", endMemory.nativeHeapKb.toDouble())
    putDouble(
      "peakNativeHeapKb",
      (samples.maxOfOrNull { it.nativeHeapKb } ?: endMemory.nativeHeapKb).toDouble(),
    )
    putDouble("startJavaHeapKb", startMemory.javaHeapKb.toDouble())
    putDouble("endJavaHeapKb", endMemory.javaHeapKb.toDouble())
    putDouble(
      "peakJavaHeapKb",
      (samples.maxOfOrNull { it.javaHeapKb } ?: endMemory.javaHeapKb).toDouble(),
    )
  }

  private fun frameStats(
    timestamps: List<Long>,
    durationMs: Double,
    refreshRate: Double,
  ) = Arguments.createMap().apply {
    val intervals = timestamps.zipWithNext { first, second ->
      (second - first) / 1_000_000.0
    }.sorted()
    val budgetMs = 1000.0 / refreshRate
    val missed = intervals.sumOf { max(0, round(it / budgetMs).toInt() - 1) }
    putDouble("fps", if (durationMs > 0) timestamps.size * 1000 / durationMs else 0.0)
    putInt("frameCount", timestamps.size)
    putInt("missedFrames", missed)
    putDouble("p50Ms", percentile(intervals, 0.50))
    putDouble("p90Ms", percentile(intervals, 0.90))
    putDouble("p95Ms", percentile(intervals, 0.95))
    putDouble("p99Ms", percentile(intervals, 0.99))
    putDouble("maxMs", intervals.lastOrNull() ?: 0.0)
  }

  private fun percentile(sorted: List<Double>, quantile: Double): Double {
    if (sorted.isEmpty()) {
      return 0.0
    }
    val index = (ceil(sorted.size * quantile).toInt() - 1).coerceIn(0, sorted.lastIndex)
    return sorted[index]
  }

  private fun refreshRate(): Double {
    val activityRate = context.currentActivity?.display?.refreshRate
    if (activityRate != null && activityRate > 0) {
      return activityRate.toDouble()
    }
    val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    @Suppress("DEPRECATION")
    return windowManager.defaultDisplay.refreshRate.toDouble()
  }

  private fun thermalStatus(): Int {
    val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    return powerManager.currentThermalStatus
  }

  private fun batteryTemperature(): Double {
    val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    return intent?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0)?.div(10.0) ?: 0.0
  }
}
