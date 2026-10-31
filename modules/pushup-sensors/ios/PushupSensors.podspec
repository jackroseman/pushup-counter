Pod::Spec.new do |s|
  s.name           = 'PushupSensors'
  s.version        = '0.1.0'
  s.summary        = 'Proximity sensor + TrueDepth (ARKit) face distance + live face mesh view for PushupCounter'
  s.description    = 'Local Expo module exposing UIDevice proximity events and ARFaceTrackingConfiguration face-to-camera distance.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'ARKit', 'AVFoundation', 'UIKit', 'SceneKit'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
