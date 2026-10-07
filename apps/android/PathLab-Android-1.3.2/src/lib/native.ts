import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { TranslationBridge, TranslationRequest, TranslationResponse } from './translation';

export interface NativeProjectFile {
  cancelled?: boolean;
  failed?: boolean;
  message?: string;
  relativePath?: string;
  fileName?: string;
}

interface PathLabNativePlugin {
  invoke(options: { request: TranslationRequest }): Promise<TranslationResponse>;
  pickProject(): Promise<NativeProjectFile>;
  consumeOpenedProject(): Promise<NativeProjectFile>;
  addListener(eventName: 'projectOpened', listenerFunc: (project: NativeProjectFile) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'projectOpenFailed', listenerFunc: (error: { message?: string }) => void): Promise<PluginListenerHandle>;
}

export const PathLabNative = registerPlugin<PathLabNativePlugin>('PathLabNative');

export function installNativeBridges(): void {
  if (!isNativeApp() || window.pathlabTranslation) return;
  const bridge: TranslationBridge = {
    invoke: (request) => PathLabNative.invoke({ request }),
  };
  window.pathlabTranslation = bridge;
}

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform() && ['ios', 'android'].includes(Capacitor.getPlatform());
}

export function isIOSApp(): boolean {
  return Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();
}

export function isAndroidApp(): boolean {
  return Capacitor.getPlatform() === 'android' && Capacitor.isNativePlatform();
}
