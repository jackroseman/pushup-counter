import ExpoModulesCore
import ARKit
import AVFoundation
import UIKit

private let proximityEvent = "onProximityChange"
private let faceDistanceEvent = "onFaceDistance"
private let faceErrorEvent = "onFaceTrackingError"

/// Wall-clock milliseconds, the same time base as JavaScript's `Date.now()`.
private func nowMs() -> Double {
  return Date().timeIntervalSince1970 * 1000.0
}

public class PushupSensorsModule: Module {
  private var proximityObserver: NSObjectProtocol?
  private var faceTracker: FaceDistanceTracker?

  public func definition() -> ModuleDefinition {
    Name("PushupSensors")

    Events(proximityEvent, faceDistanceEvent, faceErrorEvent)

    // True only on devices with a TrueDepth (Face ID) front camera.
    Function("isFaceTrackingSupported") { () -> Bool in
      return ARFaceTrackingConfiguration.isSupported
    }

    // Enables UIDevice proximity monitoring. Resolves false if the device has no
    // proximity sensor (iOS silently leaves isProximityMonitoringEnabled = false).
    // NOTE: while the sensor reads "near", iOS turns the screen off. The app stays
    // in the foreground and JS keeps running.
    AsyncFunction("startProximity") { () -> Bool in
      let device = UIDevice.current
      device.isProximityMonitoringEnabled = true
      guard device.isProximityMonitoringEnabled else {
        return false
      }
      if self.proximityObserver == nil {
        self.proximityObserver = NotificationCenter.default.addObserver(
          forName: UIDevice.proximityStateDidChangeNotification,
          object: device,
          queue: .main
        ) { [weak self] _ in
          // Hop explicitly to the main queue (same pattern as expo-keep-awake) so the
          // main-actor UIDevice read is unambiguous to the compiler.
          let timestamp = nowMs()
          DispatchQueue.main.async {
            self?.sendEvent(proximityEvent, [
              "near": UIDevice.current.proximityState,
              "timestamp": timestamp
            ])
          }
        }
      }
      return true
    }.runOnQueue(.main)

    AsyncFunction("stopProximity") {
      self.stopProximityMonitoring()
    }.runOnQueue(.main)

    // Starts ARKit face tracking on the TrueDepth camera and emits
    // { distance (meters, face anchor -> camera), tracked, timestamp } at up to `maxHz`.
    // Resolves false when unsupported or camera permission is denied.
    AsyncFunction("startFaceDistance") { (maxHz: Double, promise: Promise) in
      guard ARFaceTrackingConfiguration.isSupported else {
        promise.resolve(false)
        return
      }
      AVCaptureDevice.requestAccess(for: .video) { granted in
        DispatchQueue.main.async {
          guard granted else {
            promise.resolve(false)
            return
          }
          if self.faceTracker == nil {
            let hz = maxHz > 0 ? maxHz : 30
            self.faceTracker = FaceDistanceTracker(
              maxHz: hz,
              onSample: { [weak self] distance, tracked, metrics in
                var payload: [String: Any] = [
                  "distance": distance,
                  "tracked": tracked,
                  "timestamp": nowMs()
                ]
                if let m = metrics {
                  payload["offsetX"] = Double(m.offsetX)
                  payload["offsetY"] = Double(m.offsetY)
                  payload["pitch"] = Double(m.pitch)
                  payload["yaw"] = Double(m.yaw)
                  payload["roll"] = Double(m.roll)
                }
                self?.sendEvent(faceDistanceEvent, payload)
              },
              onError: { [weak self] message in
                self?.sendEvent(faceErrorEvent, ["message": message])
              }
            )
          }
          self.faceTracker?.start()
          promise.resolve(true)
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("stopFaceDistance") {
      self.stopFaceTracking()
    }.runOnQueue(.main)

    // Puts the app audio session in .playback so spoken rep counts are audible even
    // with the ring/silent switch on, ducking (not stopping) the user's music.
    AsyncFunction("enablePlaybackAudioSession") {
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers, .mixWithOthers])
      try session.setActive(true)
    }.runOnQueue(.main)

    // Live face mesh + measurements, rendered natively from the SAME ARSession as above
    // (no second camera session, no per-frame data over the bridge).
    View(FaceMeshView.self) {
      Prop("showAngles", true) { (view: FaceMeshView, value: Bool) in
        view.setShowAngles(value)
      }
    }

    OnDestroy {
      DispatchQueue.main.async {
        self.stopProximityMonitoring()
        self.stopFaceTracking()
      }
    }
  }

  private func stopProximityMonitoring() {
    if let observer = proximityObserver {
      NotificationCenter.default.removeObserver(observer)
      proximityObserver = nil
    }
    UIDevice.current.isProximityMonitoringEnabled = false
  }

  private func stopFaceTracking() {
    faceTracker?.stop()
    faceTracker = nil
  }
}

/// Runs the shared ARSession with ARFaceTrackingConfiguration and reports the distance between
/// the tracked face anchor and the camera, plus the face pose (offsets, angles) for calibration
/// guidance. The face mesh view renders this same session.
final class FaceDistanceTracker: NSObject, ARSessionDelegate {
  private var session: ARSession { FaceSessionHub.shared.session }
  private let minInterval: TimeInterval
  private var lastEmit: TimeInterval = 0
  private var lastTracked = false
  private let onSample: (Double, Bool, FaceMetrics?) -> Void
  private let onError: (String) -> Void
  private let delegateQueue = DispatchQueue(label: "expo.modules.pushupsensors.arkit")
  private var configuration: ARFaceTrackingConfiguration?
  private var watchdog: Timer?
  private let frameLock = NSLock()
  private var lastFrameWall: CFTimeInterval = 0

  init(maxHz: Double, onSample: @escaping (Double, Bool, FaceMetrics?) -> Void, onError: @escaping (String) -> Void) {
    self.minInterval = 1.0 / max(1.0, min(maxHz, 60.0))
    self.onSample = onSample
    self.onError = onError
    super.init()
    FaceSessionHub.shared.primaryDelegate = self
    session.delegate = self
    session.delegateQueue = delegateQueue
  }

  /// Main thread.
  func start() {
    let configuration = ARFaceTrackingConfiguration()
    configuration.maximumNumberOfTrackedFaces = 1
    configuration.isLightEstimationEnabled = false
    self.configuration = configuration
    FaceSessionHub.shared.reassertDelegate()
    session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
    markFrame()
    // Watchdog: if frames stop while we should be running (interruption, or a view detaching
    // from the session), resume the same session without resetting it.
    watchdog?.invalidate()
    watchdog = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
      self?.checkAlive()
    }
  }

  /// Main thread.
  func stop() {
    watchdog?.invalidate()
    watchdog = nil
    configuration = nil
    session.pause()
  }

  private func markFrame() {
    frameLock.lock()
    lastFrameWall = CACurrentMediaTime()
    frameLock.unlock()
  }

  private func checkAlive() {
    guard let configuration = configuration else { return }
    guard UIApplication.shared.applicationState == .active else { return }
    frameLock.lock()
    let age = CACurrentMediaTime() - lastFrameWall
    frameLock.unlock()
    FaceSessionHub.shared.reassertDelegate()
    if age > 2.0 {
      session.run(configuration)
      markFrame()
    }
  }

  // MARK: ARSessionDelegate

  func session(_ session: ARSession, didUpdate frame: ARFrame) {
    markFrame()
    // Throttle (~30 Hz by default). Read what we need and do not retain the frame.
    let t = frame.timestamp
    if t - lastEmit < minInterval {
      return
    }
    lastEmit = t

    let cameraColumn = frame.camera.transform.columns.3
    let cameraPosition = simd_float3(cameraColumn.x, cameraColumn.y, cameraColumn.z)

    var distance: Double = 0
    var tracked = false
    var metrics: FaceMetrics?
    for anchor in frame.anchors {
      guard let face = anchor as? ARFaceAnchor, face.isTracked else { continue }
      let faceColumn = face.transform.columns.3
      let facePosition = simd_float3(faceColumn.x, faceColumn.y, faceColumn.z)
      distance = Double(simd_distance(facePosition, cameraPosition))
      metrics = FaceMetrics.compute(face: face, camera: frame.camera)
      tracked = true
      break
    }

    // Emit every tracked sample, but only the first "lost" sample of a gap.
    if tracked || lastTracked {
      onSample(distance, tracked, metrics)
    }
    lastTracked = tracked
  }

  func session(_ session: ARSession, didFailWithError error: Error) {
    onError(error.localizedDescription)
  }

  func sessionWasInterrupted(_ session: ARSession) {
    lastTracked = false
    onSample(0, false, nil)
  }
}
