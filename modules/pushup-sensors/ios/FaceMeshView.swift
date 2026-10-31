import ARKit
import ExpoModulesCore
import SceneKit
import UIKit

private let meshColor = UIColor(red: 0.36, green: 0.78, blue: 1.0, alpha: 0.9)
private let markerColor = UIColor(red: 1.0, green: 0.69, blue: 0.13, alpha: 1.0)
private let backgroundColorDark = UIColor(red: 0.043, green: 0.059, blue: 0.102, alpha: 1.0)
private let okColor = UIColor(red: 0.17, green: 0.84, blue: 0.48, alpha: 1.0)
private let badColor = UIColor(red: 1.0, green: 0.35, blue: 0.37, alpha: 1.0)
private let mutedColor = UIColor(red: 0.54, green: 0.58, blue: 0.66, alpha: 1.0)

/// What the overlay shows; produced on the SceneKit render thread, applied on main.
struct FaceMeshSnapshot {
  enum State { case waiting, tracked, lost }
  var state: State
  var metrics: FaceMetrics?
  /// Distance (m) from the camera to the closest face-mesh vertex (the "lowest point").
  var closestDistance: Float?
  /// Where that vertex is on screen (view points).
  var closestPoint: CGPoint?
}

/// SceneKit delegate for the ARSCNView. Lives off the main actor: SceneKit calls it on its
/// render thread at camera rate. It updates the wireframe mesh + closest-vertex marker in 3D
/// directly, and pushes a throttled snapshot to the main thread for the text overlays.
final class FaceMeshRenderer: NSObject, ARSCNViewDelegate {
  var onSnapshot: (@MainActor (FaceMeshSnapshot) -> Void)?

  private let session = FaceSessionHub.shared.session
  private let marker: SCNNode
  private let lock = NSLock()
  private var uiInterval: CFTimeInterval = 1.0 / 15.0
  private var lastPush: CFTimeInterval = 0
  private var lastFrameTimestamp: TimeInterval = -1
  private var lastFrameChange: CFTimeInterval = 0
  // Render-thread state from the latest anchor update.
  private var closestDistance: Float?
  private var closestWorld: simd_float3?

  override init() {
    let sphere = SCNSphere(radius: 0.004)
    let material = SCNMaterial()
    material.diffuse.contents = markerColor
    material.lightingModel = .constant
    material.readsFromDepthBuffer = false
    sphere.materials = [material]
    marker = SCNNode(geometry: sphere)
    marker.renderingOrder = 100
    super.init()
  }

  func setUIRate(_ hz: Double) {
    lock.lock()
    uiInterval = 1.0 / max(1.0, hz)
    lock.unlock()
  }

  // MARK: ARSCNViewDelegate

  func renderer(_ renderer: SCNSceneRenderer, nodeFor anchor: ARAnchor) -> SCNNode? {
    guard anchor is ARFaceAnchor, let device = renderer.device,
          let geometry = ARSCNFaceGeometry(device: device) else { return nil }
    if let material = geometry.firstMaterial {
      material.fillMode = .lines
      material.diffuse.contents = meshColor
      material.lightingModel = .constant
      material.isDoubleSided = true
    }
    let node = SCNNode(geometry: geometry)
    marker.removeFromParentNode()
    node.addChildNode(marker)
    return node
  }

  func renderer(_ renderer: SCNSceneRenderer, didUpdate node: SCNNode, for anchor: ARAnchor) {
    guard let face = anchor as? ARFaceAnchor else { return }
    (node.geometry as? ARSCNFaceGeometry)?.update(from: face.geometry)
    node.isHidden = !face.isTracked
    guard face.isTracked, let pov = renderer.pointOfView else {
      closestDistance = nil
      closestWorld = nil
      return
    }
    // Closest mesh vertex to the camera (~1.2k vertices, cheap).
    let camera = pov.simdWorldPosition
    let transform = face.transform
    var best = Float.greatestFiniteMagnitude
    var bestLocal = simd_float3(0, 0, 0)
    var bestWorld = simd_float3(0, 0, 0)
    for v in face.geometry.vertices {
      let w4 = transform * simd_float4(v.x, v.y, v.z, 1)
      let w = simd_float3(w4.x, w4.y, w4.z)
      let d = simd_distance(w, camera)
      if d < best {
        best = d
        bestLocal = v
        bestWorld = w
      }
    }
    marker.simdPosition = bestLocal
    closestDistance = best
    closestWorld = bestWorld
  }

  func renderer(_ renderer: SCNSceneRenderer, didRemove node: SCNNode, for anchor: ARAnchor) {
    if anchor is ARFaceAnchor {
      closestDistance = nil
      closestWorld = nil
    }
  }

  func renderer(_ renderer: SCNSceneRenderer, updateAtTime time: TimeInterval) {
    let now = CACurrentMediaTime()
    // ARSCNView normally paints the camera feed as the scene background; keep ours (dark, no
    // camera image) in case it gets replaced when the session (re)starts.
    if let background = renderer.scene?.background, !(background.contents is UIColor) {
      background.contents = backgroundColorDark
    }
    lock.lock()
    let interval = uiInterval
    lock.unlock()
    if now - lastPush < interval { return }
    lastPush = now

    guard let frame = session.currentFrame else {
      push(FaceMeshSnapshot(state: .waiting, metrics: nil, closestDistance: nil, closestPoint: nil))
      return
    }
    if frame.timestamp != lastFrameTimestamp {
      lastFrameTimestamp = frame.timestamp
      lastFrameChange = now
    }
    if now - lastFrameChange > 1.0 {
      push(FaceMeshSnapshot(state: .waiting, metrics: nil, closestDistance: nil, closestPoint: nil))
      return
    }
    var face: ARFaceAnchor?
    for anchor in frame.anchors {
      if let f = anchor as? ARFaceAnchor, f.isTracked {
        face = f
        break
      }
    }
    guard let trackedFace = face else {
      push(FaceMeshSnapshot(state: .lost, metrics: nil, closestDistance: nil, closestPoint: nil))
      return
    }
    let metrics = FaceMetrics.compute(face: trackedFace, camera: frame.camera)
    var point: CGPoint?
    if let w = closestWorld {
      let p = renderer.projectPoint(SCNVector3(w.x, w.y, w.z))
      point = CGPoint(x: CGFloat(p.x), y: CGFloat(p.y))
    }
    push(FaceMeshSnapshot(state: .tracked, metrics: metrics, closestDistance: closestDistance, closestPoint: point))
  }

  private func push(_ snapshot: FaceMeshSnapshot) {
    guard let callback = onSnapshot else { return }
    DispatchQueue.main.async {
      callback(snapshot)
    }
  }
}

/// Native face view: the live ARKit face mesh (wireframe on a dark background) with real
/// measurements drawn natively. Binds an ARSCNView to the module's existing ARSession; it never
/// runs or pauses the session itself, so it cannot change rep counting.
final class FaceMeshView: ExpoView {
  private var sceneView: ARSCNView?
  private let meshRenderer = FaceMeshRenderer()
  private let distanceLabel = UILabel()
  private let distanceCaption = UILabel()
  private let stateLabel = PaddedLabel()
  private let anglesLabel = UILabel()
  private let closestLabel = PaddedLabel()
  private let messageLabel = UILabel()
  private let thermalLabel = UILabel()
  private var thermalObserver: NSObjectProtocol?
  private var showAngles = true
  private var lastSnapshot: FaceMeshSnapshot?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = backgroundColorDark
    layer.cornerRadius = 16

    setUpLabels()

    guard ARFaceTrackingConfiguration.isSupported else {
      messageLabel.text = "Face view needs a Face ID (TrueDepth) camera.\nThis device doesn't have one."
      messageLabel.isHidden = false
      stateLabel.isHidden = true
      distanceLabel.isHidden = true
      distanceCaption.isHidden = true
      return
    }

    let view = ARSCNView(frame: .zero)
    // Bind to the module's one and only session (the rep-counting tracker runs it).
    view.session = FaceSessionHub.shared.session
    FaceSessionHub.shared.reassertDelegate()
    view.delegate = meshRenderer
    view.automaticallyUpdatesLighting = false
    view.scene.background.contents = backgroundColorDark
    view.backgroundColor = backgroundColorDark
    view.preferredFramesPerSecond = 30
    view.antialiasingMode = .multisampling4X
    view.isUserInteractionEnabled = false
    insertSubview(view, at: 0)
    sceneView = view

    meshRenderer.onSnapshot = { [weak self] snapshot in
      self?.apply(snapshot)
    }
    apply(FaceMeshSnapshot(state: .waiting, metrics: nil, closestDistance: nil, closestPoint: nil))

    thermalObserver = NotificationCenter.default.addObserver(
      forName: ProcessInfo.thermalStateDidChangeNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      DispatchQueue.main.async {
        self?.applyThermalState()
      }
    }
    applyThermalState()
  }

  deinit {
    if let observer = thermalObserver {
      NotificationCenter.default.removeObserver(observer)
    }
  }

  func setShowAngles(_ value: Bool) {
    showAngles = value
    if let s = lastSnapshot {
      apply(s)
    }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    // Never pause the shared session here; just make sure rep counting still owns its delegate.
    FaceSessionHub.shared.reassertDelegate()
  }

  // MARK: Layout

  override func layoutSubviews() {
    super.layoutSubviews()
    let b = bounds
    sceneView?.frame = b
    let pad: CGFloat = 14
    distanceLabel.frame = CGRect(x: pad, y: pad - 4, width: b.width * 0.6, height: 52)
    distanceCaption.frame = CGRect(x: pad, y: pad + 46, width: b.width * 0.6, height: 16)
    let stateSize = stateLabel.intrinsicContentSize
    stateLabel.frame = CGRect(x: b.width - pad - stateSize.width, y: pad, width: stateSize.width, height: stateSize.height)
    thermalLabel.frame = CGRect(x: b.width * 0.4, y: pad + stateSize.height + 4, width: b.width * 0.6 - pad, height: 16)
    anglesLabel.frame = CGRect(x: pad, y: b.height - pad - 20, width: b.width - pad * 2, height: 20)
    messageLabel.frame = CGRect(x: pad * 2, y: b.height * 0.3, width: b.width - pad * 4, height: b.height * 0.4)
  }

  // MARK: Overlays

  private func setUpLabels() {
    distanceLabel.font = UIFont.monospacedDigitSystemFont(ofSize: 44, weight: .heavy)
    distanceLabel.textColor = .white
    distanceLabel.adjustsFontSizeToFitWidth = true
    distanceLabel.minimumScaleFactor = 0.5
    distanceLabel.text = "—"

    distanceCaption.font = UIFont.systemFont(ofSize: 12, weight: .semibold)
    distanceCaption.textColor = mutedColor
    distanceCaption.text = "FACE ↔ PHONE"

    stateLabel.font = UIFont.systemFont(ofSize: 13, weight: .bold)
    stateLabel.textColor = .black
    stateLabel.layer.cornerRadius = 11
    stateLabel.layer.masksToBounds = true
    stateLabel.insets = UIEdgeInsets(top: 4, left: 10, bottom: 4, right: 10)

    thermalLabel.font = UIFont.systemFont(ofSize: 11, weight: .semibold)
    thermalLabel.textColor = markerColor
    thermalLabel.textAlignment = .right
    thermalLabel.isHidden = true

    anglesLabel.font = UIFont.monospacedDigitSystemFont(ofSize: 14, weight: .semibold)
    anglesLabel.textColor = UIColor.white.withAlphaComponent(0.85)
    anglesLabel.textAlignment = .center

    closestLabel.font = UIFont.monospacedDigitSystemFont(ofSize: 12, weight: .bold)
    closestLabel.textColor = .black
    closestLabel.backgroundColor = markerColor
    closestLabel.layer.cornerRadius = 8
    closestLabel.layer.masksToBounds = true
    closestLabel.insets = UIEdgeInsets(top: 2, left: 6, bottom: 2, right: 6)
    closestLabel.isHidden = true

    messageLabel.font = UIFont.systemFont(ofSize: 16, weight: .semibold)
    messageLabel.textColor = UIColor.white.withAlphaComponent(0.9)
    messageLabel.textAlignment = .center
    messageLabel.numberOfLines = 0
    messageLabel.isHidden = true

    for label in [distanceLabel, distanceCaption, stateLabel, thermalLabel, anglesLabel, closestLabel, messageLabel] as [UIView] {
      label.isUserInteractionEnabled = false
      addSubview(label)
    }
  }

  private func setState(_ text: String, _ color: UIColor) {
    if stateLabel.text != text {
      stateLabel.text = text
      stateLabel.backgroundColor = color
      setNeedsLayout()
    }
  }

  private func apply(_ snapshot: FaceMeshSnapshot) {
    lastSnapshot = snapshot
    switch snapshot.state {
    case .waiting:
      setState("● Camera starting", mutedColor)
      distanceLabel.text = "—"
      anglesLabel.text = ""
      closestLabel.isHidden = true
      messageLabel.text = "Waiting for the Face ID camera…"
      messageLabel.isHidden = false
    case .lost:
      setState("● Face lost", badColor)
      distanceLabel.text = "—"
      anglesLabel.text = ""
      closestLabel.isHidden = true
      messageLabel.text = "Face lost — keep your face over the phone"
      messageLabel.isHidden = false
    case .tracked:
      setState("● Tracking", okColor)
      messageLabel.isHidden = true
      if let m = snapshot.metrics {
        distanceLabel.text = String(format: "%.1f cm", m.distance * 100)
        anglesLabel.text = showAngles
          ? String(format: "pitch %+.0f°   yaw %+.0f°   roll %+.0f°", m.pitch, m.yaw, m.roll)
          : ""
      }
      if let d = snapshot.closestDistance, let p = snapshot.closestPoint, bounds.contains(p) {
        closestLabel.text = String(format: "closest %.1f cm", d * 100)
        let size = closestLabel.intrinsicContentSize
        var x = p.x + 10
        if x + size.width > bounds.width - 6 { x = p.x - 10 - size.width }
        let y = min(max(6, p.y - size.height / 2), bounds.height - size.height - 6)
        closestLabel.frame = CGRect(x: x, y: y, width: size.width, height: size.height)
        closestLabel.isHidden = false
      } else {
        closestLabel.isHidden = true
      }
    }
  }

  private func applyThermalState() {
    guard let view = sceneView else { return }
    switch ProcessInfo.processInfo.thermalState {
    case .critical:
      view.preferredFramesPerSecond = 5
      meshRenderer.setUIRate(2)
      thermalLabel.text = "Phone is hot — view throttled"
      thermalLabel.isHidden = false
    case .serious:
      view.preferredFramesPerSecond = 15
      meshRenderer.setUIRate(6)
      thermalLabel.text = "Phone is warm — view slowed"
      thermalLabel.isHidden = false
    default:
      view.preferredFramesPerSecond = 30
      meshRenderer.setUIRate(15)
      thermalLabel.isHidden = true
    }
  }
}

/// UILabel with padding (for pill badges).
final class PaddedLabel: UILabel {
  var insets = UIEdgeInsets.zero

  override func drawText(in rect: CGRect) {
    super.drawText(in: rect.inset(by: insets))
  }

  override var intrinsicContentSize: CGSize {
    let s = super.intrinsicContentSize
    return CGSize(width: s.width + insets.left + insets.right, height: s.height + insets.top + insets.bottom)
  }
}
