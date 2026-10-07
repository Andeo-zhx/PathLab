export type TranslationLanguage = 'zh' | 'en';

export type TranslationRequest =
  | { op: 'translate'; text: string; sourceLanguage: TranslationLanguage; targetLanguage: TranslationLanguage }
  | { op: 'status' }
  | { op: 'save-key'; key: string }
  | { op: 'delete-key' }
  | { op: 'cancel' };

export type TranslationResponse =
  | { ok: true; text?: string; keyConfigured?: boolean; cancelled?: boolean }
  | { ok: false; code: string; message: string };

export interface TranslationBridge {
  invoke: (request: TranslationRequest) => Promise<TranslationResponse>;
}

declare global {
  interface Window {
    pathlabTranslation?: TranslationBridge;
  }
}
