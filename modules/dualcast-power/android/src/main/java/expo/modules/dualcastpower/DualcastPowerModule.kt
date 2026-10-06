package expo.modules.dualcastpower

import android.content.Context
import android.content.Intent
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Keeps the phone working with the screen off:
 *  - a PARTIAL wake lock so the CPU is not suspended (JS timers, audio capture, sockets keep running),
 *  - a Wi-Fi lock so the Wi-Fi radio is not put to sleep (WebSocket to Deepgram, HTTP to DeepL/ElevenLabs),
 *  - a shortcut to the system "ignore battery optimizations" dialog.
 * A foreground service alone does NOT prevent the CPU from sleeping.
 */
class DualcastPowerModule : Module() {
  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null
  private var proximityListener: SensorEventListener? = null

  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("React context unavailable")

  override fun definition() = ModuleDefinition {
    Name("DualcastPower")

    // Fires { near: Boolean, distance: Float } each time the proximity sensor changes.
    Events("onProximity")

    // Safety timeout (12 h) so a crash can never leave a lock held forever.
    Function("acquireWakeLocks") {
      val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      if (wakeLock == null) {
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "DualCast:translation").apply {
          setReferenceCounted(false)
        }
      }
      if (wakeLock?.isHeld != true) wakeLock?.acquire(12L * 60 * 60 * 1000)

      try {
        val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        if (wifiLock == null) {
          @Suppress("DEPRECATION")
          wifiLock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "DualCast:wifi").apply {
            setReferenceCounted(false)
          }
        }
        if (wifiLock?.isHeld != true) wifiLock?.acquire()
      } catch (e: Exception) {
        // Wi-Fi lock is best effort (no Wi-Fi, restricted OEM…): the CPU lock is what matters most.
      }
      wakeLock?.isHeld == true
    }

    Function("releaseWakeLocks") {
      if (wakeLock?.isHeld == true) wakeLock?.release()
      if (wifiLock?.isHeld == true) wifiLock?.release()
      true
    }

    Function("isIgnoringBatteryOptimizations") {
      val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      power.isIgnoringBatteryOptimizations(context.packageName)
    }

    Function("requestIgnoreBatteryOptimizations") {
      val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
        data = Uri.parse("package:" + context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      context.startActivity(intent)
      true
    }

    // Proximity sensor: tells whether the phone is held against the face (a call) or lying on a table.
    // Returns false when the phone has no proximity sensor.
    Function("startProximity") {
      if (proximityListener != null) return@Function true
      val manager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
      val sensor = manager.getDefaultSensor(Sensor.TYPE_PROXIMITY) ?: return@Function false
      val module = this@DualcastPowerModule
      val listener = object : SensorEventListener {
        override fun onSensorChanged(event: SensorEvent) {
          val distance = event.values[0]
          // Most sensors are binary (0 = covered, max range = free); "near" = clearly below the range.
          val near = distance < minOf(sensor.maximumRange, 5f)
          module.sendEvent("onProximity", mapOf("near" to near, "distance" to distance))
        }

        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
      }
      manager.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_NORMAL)
      proximityListener = listener
      true
    }

    Function("stopProximity") {
      proximityListener?.let {
        val manager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        manager.unregisterListener(it)
      }
      proximityListener = null
      true
    }

    OnDestroy {
      proximityListener?.let {
        (appContext.reactContext?.getSystemService(Context.SENSOR_SERVICE) as? SensorManager)?.unregisterListener(it)
      }
      proximityListener = null
      if (wakeLock?.isHeld == true) wakeLock?.release()
      if (wifiLock?.isHeld == true) wifiLock?.release()
    }
  }
}
