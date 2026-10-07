import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.pathlab.mobile',
  appName: 'PathLab',
  webDir: 'dist',
  ios: {
    // The app applies env(safe-area-inset-*) in CSS; native adjustment would
    // shift WKWebView input hit testing on iPad when both inset systems apply.
    contentInset: 'never',
    preferredContentMode: 'mobile',
  },
};

export default config;
