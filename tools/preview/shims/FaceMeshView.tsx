/**
 * PREVIEW BUILD ONLY. Replaces modules/pushup-sensors/src/FaceMeshView.tsx on web in the preview
 * build. The real view is a native ARKit mesh; the browser has no camera, so draw the black field
 * the minimal variant shows behind the mesh instead of the "needs an iPhone" placeholder.
 */
import * as React from 'react';
import { View } from 'react-native';

import type { FaceMeshViewProps } from '../../../modules/pushup-sensors/src/PushupSensors.types';

export function FaceMeshView(props: FaceMeshViewProps) {
  return <View style={[props.style, { backgroundColor: '#0A0A0C' }]} />;
}
