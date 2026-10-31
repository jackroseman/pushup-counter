package expo.modules.pushupsensors

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android: proximity via SensorManager (best effort; most Android proximity sensors are
 * binary near/far like iOS). There is no TrueDepth/ARKit equivalent, so face distance is a
 * no-op that resolves false and the app falls back to proximity-only counting.
 */
class PushupSensorsModule : Module() {
  private var sensorManager: SensorManager? = null
  private var lastNear: Boolean? = null

  private val proximityListener = object : SensorEventListener {
    override fun onSensorChanged(event: SensorEvent?) {
      val e = event ?: return
      if (e.values.isEmpty()) return
      val threshold = minOf(e.sensor.maximumRange, 5f)
      val near = e.values[0] < threshold
      if (near != lastNear) {
        lastNear = near
        this@PushupSensorsModule.sendEvent(
          "onProximityChange",
          mapOf("near" to near, "timestamp" to System.currentTimeMillis().toDouble())
        )
      }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
  }

  override fun definition() = ModuleDefinition {
    Name("PushupSensors")

    Events("onProximityChange", "onFaceDistance", "onFaceTrackingError")

    Function("isFaceTrackingSupported") {
      false
    }

    AsyncFunction("startProximity") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      val manager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
        ?: return@AsyncFunction false
      val sensor = manager.getDefaultSensor(Sensor.TYPE_PROXIMITY) ?: return@AsyncFunction false
      sensorManager?.unregisterListener(proximityListener)
      sensorManager = manager
      lastNear = null
      manager.registerListener(proximityListener, sensor, SensorManager.SENSOR_DELAY_GAME)
      true
    }

    AsyncFunction("stopProximity") {
      sensorManager?.unregisterListener(proximityListener)
      sensorManager = null
    }

    AsyncFunction("startFaceDistance") { _: Double ->
      false
    }

    AsyncFunction("stopFaceDistance") {}

    AsyncFunction("enablePlaybackAudioSession") {}

    OnDestroy {
      sensorManager?.unregisterListener(proximityListener)
      sensorManager = null
    }
  }
}
