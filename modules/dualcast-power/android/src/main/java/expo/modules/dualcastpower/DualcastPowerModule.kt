package expo.modules.dualcastpower

import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AudioEffect
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.PowerManager
import android.provider.Settings
import android.util.Base64
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
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

  // Native microphone capture (see startCapture)
  private var audioRecord: AudioRecord? = null
  private var captureThread: Thread? = null
  @Volatile private var capturing = false
  private val effects = mutableListOf<AudioEffect>()

  // Speaker playback (see speakerOpen): the translated voice for the person in front of the phone goes to the BUILT-IN
  // SPEAKER while everything else (the headset) keeps its normal route.
  @Volatile private var speakerTrack: AudioTrack? = null
  private var speakerRate = 0
  private val speakerFrames = AtomicLong(0)
  private val speakerExecutor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "DualCast-speaker").also { it.isDaemon = true }
  }

  // Native timers (see setTimer): React Native's own JS timers are suspended when the screen is off.
  private val timerExecutor = Executors.newSingleThreadScheduledExecutor { runnable ->
    Thread(runnable, "DualCast-timers").also { it.isDaemon = true }
  }
  private val timers = ConcurrentHashMap<Int, ScheduledFuture<*>>()

  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("React context unavailable")

  override fun definition() = ModuleDefinition {
    Name("DualcastPower")

    // PCM16 mono chunks from startCapture(), base64 encoded: { data: String }
    Events("onAudio", "onTimer")

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

    /**
     * Capture the microphone ourselves (16 kHz, mono, 16-bit, 100 ms chunks) so the audio SOURCE can be
     * chosen — react-native-audio-api always opens the default one, which on some phones is very faint.
     *  source: "voice_recognition" | "mic" | "camcorder" | "unprocessed" | "voice_communication"
     *  deviceId: Android AudioDeviceInfo id of a specific microphone, or -1 for the default
     *  agc / ns: switch on the phone's own automatic gain control / noise suppression when it has them
     * Returns "ok;agc=<bool>;ns=<bool>" or an error code.
     */
    Function("startCapture") { source: String, deviceId: Int, agc: Boolean, ns: Boolean ->
      stopCaptureInternal()
      val sampleRate = 16000
      val chunkFrames = sampleRate / 10
      val audioSource = when (source) {
        "voice_recognition" -> MediaRecorder.AudioSource.VOICE_RECOGNITION
        "camcorder" -> MediaRecorder.AudioSource.CAMCORDER
        "unprocessed" -> if (android.os.Build.VERSION.SDK_INT >= 24) MediaRecorder.AudioSource.UNPROCESSED else MediaRecorder.AudioSource.MIC
        "voice_communication" -> MediaRecorder.AudioSource.VOICE_COMMUNICATION
        else -> MediaRecorder.AudioSource.MIC
      }
      val minBuffer = AudioRecord.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
      if (minBuffer <= 0) return@Function "error_buffer_size"
      val record = AudioRecord(
        audioSource,
        sampleRate,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        maxOf(minBuffer, chunkFrames * 2 * 4),
      )
      if (record.state != AudioRecord.STATE_INITIALIZED) {
        record.release()
        return@Function "error_init"
      }

      if (deviceId >= 0) {
        val manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        manager.getDevices(AudioManager.GET_DEVICES_INPUTS).firstOrNull { it.id == deviceId }?.let {
          record.setPreferredDevice(it)
        }
      }

      var agcOn = false
      var nsOn = false
      try {
        if (agc && AutomaticGainControl.isAvailable()) {
          AutomaticGainControl.create(record.audioSessionId)?.let {
            it.setEnabled(true)
            effects.add(it)
            agcOn = true
          }
        }
        if (ns && NoiseSuppressor.isAvailable()) {
          NoiseSuppressor.create(record.audioSessionId)?.let {
            it.setEnabled(true)
            effects.add(it)
            nsOn = true
          }
        }
      } catch (e: Exception) {
        // Effects are best effort: capture still works without them.
      }

      try {
        record.startRecording()
      } catch (e: Exception) {
        record.release()
        return@Function "error_start"
      }
      audioRecord = record
      capturing = true
      val module = this@DualcastPowerModule
      captureThread = Thread {
        val buffer = ByteArray(chunkFrames * 2)
        while (capturing) {
          var offset = 0
          while (offset < buffer.size && capturing) {
            val read = record.read(buffer, offset, buffer.size - offset)
            if (read <= 0) break
            offset += read
          }
          if (offset == buffer.size && capturing) {
            module.sendEvent("onAudio", mapOf("data" to Base64.encodeToString(buffer, Base64.NO_WRAP)))
          } else if (offset == 0) {
            break
          }
        }
      }.also {
        it.name = "DualCast-capture"
        it.start()
      }
      "ok;agc=$agcOn;ns=$nsOn"
    }

    /**
     * One-shot timer that keeps working with the screen off (the CPU is held awake by the wake lock): after
     * `delayMs` an "onTimer" event { id } is sent to JS. JS timers (setTimeout) are suspended in the background.
     */
    Function("setTimer") { id: Int, delayMs: Int ->
      val module = this@DualcastPowerModule
      val future = timerExecutor.schedule(Runnable {
        timers.remove(id)
        module.sendEvent("onTimer", mapOf("id" to id))
      }, delayMs.toLong(), TimeUnit.MILLISECONDS)
      timers[id] = future
      true
    }

    Function("clearTimer") { id: Int ->
      timers.remove(id)?.cancel(false)
      true
    }

    /**
     * Open (or keep) a mono 16-bit PCM stream at `sampleRate` aimed at the phone's BUILT-IN SPEAKER, even when a
     * Bluetooth or wired headset is connected (the headset keeps what the app plays elsewhere).
     * Returns "ok", "ok;speaker=none" (no built-in speaker found: the system picks), "ok;preferred=false" (refused: the
     * system picks) or an error code.
     */
    Function("speakerOpen") { sampleRate: Int ->
      if (speakerTrack != null && speakerRate == sampleRate) return@Function "ok"
      speakerCloseInternal()
      val minBuffer = AudioTrack.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
      if (minBuffer <= 0) return@Function "error_buffer_size"
      try {
        val attributes = AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()
        val format = AudioFormat.Builder()
          .setSampleRate(sampleRate)
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
          .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
          .build()
        val track = AudioTrack.Builder()
          .setAudioAttributes(attributes)
          .setAudioFormat(format)
          .setBufferSizeInBytes(maxOf(minBuffer, sampleRate * 2))
          .setTransferMode(AudioTrack.MODE_STREAM)
          .build()
        var status = "ok"
        val manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val speaker = manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
        if (speaker == null) status = "ok;speaker=none"
        else if (!track.setPreferredDevice(speaker)) status = "ok;preferred=false"
        track.play()
        speakerTrack = track
        speakerRate = sampleRate
        speakerFrames.set(0)
        status
      } catch (e: Exception) {
        "error_open:" + (e.message ?: "")
      }
    }

    /** Queue PCM16 mono (base64) for the speaker stream; the writes happen on their own thread. */
    Function("speakerWrite") { base64: String ->
      val track = speakerTrack ?: return@Function false
      val bytes = Base64.decode(base64, Base64.NO_WRAP)
      speakerFrames.addAndGet((bytes.size / 2).toLong())
      speakerExecutor.execute {
        try {
          track.write(bytes, 0, bytes.size)
        } catch (e: Exception) {
          // the stream was closed meanwhile
        }
      }
      true
    }

    /** Waits until everything queued has been played (or `timeoutMs`, or the stream was closed). */
    AsyncFunction("speakerDrain") { timeoutMs: Int ->
      val track = speakerTrack ?: return@AsyncFunction true
      val deadline = System.currentTimeMillis() + timeoutMs
      var done = false
      while (!done && System.currentTimeMillis() < deadline) {
        if (speakerTrack !== track) return@AsyncFunction true
        val played = try { track.playbackHeadPosition.toLong() and 0xFFFFFFFFL } catch (e: Exception) { return@AsyncFunction true }
        done = played >= speakerFrames.get()
        if (!done) Thread.sleep(25)
      }
      done
    }

    /** Cut what is playing and close the speaker stream. */
    Function("speakerStop") {
      speakerCloseInternal()
      true
    }

    Function("stopCapture") {
      stopCaptureInternal()
      true
    }

    OnDestroy {
      stopCaptureInternal()
      speakerCloseInternal()
      speakerExecutor.shutdownNow()
      timerExecutor.shutdownNow()
      if (wakeLock?.isHeld == true) wakeLock?.release()
      if (wifiLock?.isHeld == true) wifiLock?.release()
    }
  }

  private fun speakerCloseInternal() {
    val track = speakerTrack ?: return
    speakerTrack = null
    speakerRate = 0
    speakerFrames.set(0)
    try {
      track.pause()
      track.flush()
      track.stop()
    } catch (e: Exception) {
    }
    try {
      track.release()
    } catch (e: Exception) {
    }
  }

  private fun stopCaptureInternal() {
    capturing = false
    try {
      captureThread?.join(500)
    } catch (e: InterruptedException) {
    }
    captureThread = null
    effects.forEach {
      try {
        it.release()
      } catch (e: Exception) {
      }
    }
    effects.clear()
    audioRecord?.let {
      try {
        it.stop()
      } catch (e: Exception) {
      }
      it.release()
    }
    audioRecord = null
  }
}
