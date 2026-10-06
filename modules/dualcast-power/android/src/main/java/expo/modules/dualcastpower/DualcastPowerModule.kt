package expo.modules.dualcastpower

import android.content.Context
import android.content.Intent
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

  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("React context unavailable")

  override fun definition() = ModuleDefinition {
    Name("DualcastPower")

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

    OnDestroy {
      if (wakeLock?.isHeld == true) wakeLock?.release()
      if (wifiLock?.isHeld == true) wifiLock?.release()
    }
  }
}
