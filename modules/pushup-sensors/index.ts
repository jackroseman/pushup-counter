// Re-export the native module. On web, it will be resolved to PushupSensorsModule.web.ts
// and on native platforms to PushupSensorsModule.ts
export { default } from './src/PushupSensorsModule';
export * from './src/PushupSensors.types';
export { FaceMeshView } from './src/FaceMeshView';
