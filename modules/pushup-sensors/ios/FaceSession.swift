import ARKit
import simd

/// The single ARSession used by the whole module. The distance tracker (rep counting) runs it;
/// the face mesh view only *renders* it (ARSCNView bound to this same session), so there is
/// never a second camera session.
final class FaceSessionHub {
  static let shared = FaceSessionHub()

  let session = ARSession()

  /// The rep-counting delegate. Kept so it can be re-asserted if anything replaces it.
  weak var primaryDelegate: ARSessionDelegate?

  private init() {}

  func reassertDelegate() {
    guard let primary = primaryDelegate else { return }
    if session.delegate !== primary {
      session.delegate = primary
    }
  }
}

/// Face pose numbers relative to the front (TrueDepth) camera, in the phone's portrait frame
/// as the user sees the screen.
struct FaceMetrics {
  /// Face anchor -> camera distance in meters (same number rep counting uses).
  var distance: Float
  /// Offset from the camera axis in meters: +x toward the screen's right edge, +y toward its top edge.
  var offsetX: Float
  var offsetY: Float
  /// Degrees. 0/0/0 = looking straight at the camera.
  /// pitch > 0: face tilted toward the top of the phone; yaw > 0: turned toward the screen's right edge.
  var pitch: Float
  var yaw: Float
  var roll: Float

  static func compute(face: ARFaceAnchor, camera: ARCamera) -> FaceMetrics {
    let c = camera.transform.columns.3
    let f = face.transform.columns.3
    let distance = simd_distance(simd_float3(f.x, f.y, f.z), simd_float3(c.x, c.y, c.z))

    // Face pose in portrait camera space: x = image right, y = up (toward the top edge),
    // camera looks along -z. The front camera image is not mirrored, so image-right is the
    // screen's LEFT edge as the user sees it: flip x to get screen-as-seen coordinates.
    let rel = camera.viewMatrix(for: .portrait) * face.transform
    let p = rel.columns.3
    let zAxis = simd_normalize(simd_float3(rel.columns.2.x, rel.columns.2.y, rel.columns.2.z))
    let xAxis = simd_normalize(simd_float3(rel.columns.0.x, rel.columns.0.y, rel.columns.0.z))
    let deg: Float = 180 / Float.pi
    return FaceMetrics(
      distance: distance,
      offsetX: -p.x,
      offsetY: p.y,
      pitch: asin(max(-1, min(1, zAxis.y))) * deg,
      yaw: -atan2(zAxis.x, zAxis.z) * deg,
      roll: atan2(xAxis.y, xAxis.x) * deg
    )
  }
}
