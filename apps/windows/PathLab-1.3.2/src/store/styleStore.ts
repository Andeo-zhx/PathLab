import { create } from 'zustand';
import { DEFAULT_ANNOTATION_STYLE, type AnnotationStyle } from '../lib/factory';
import { loadRecentColors, loadRoiColor, pushRecentColor, saveRoiColor } from '../lib/colors';
import { makeTextFontFamily, persistTextDefaults, readStoredTextDefaults } from '../lib/textPreferences';

interface StyleState extends AnnotationStyle {
  chineseFontFamily: string;
  englishFontFamily: string;
  recentColors: string[];
  magnifierZoom: number;
  magnifierBorderColor: string;
  magnifierRoiColor: string;
  magnifierConnector: boolean;

  setStyle: (patch: Partial<AnnotationStyle>) => void;
  setFontPair: (patch: { chineseFontFamily?: string; englishFontFamily?: string }) => void;
  useColor: (color: string) => void;
  setMagnifier: (patch: {
    zoom?: number;
    borderColor?: string;
    roiColor?: string;
    connector?: boolean;
  }) => void;
}

export const useStyle = create<StyleState>((set) => ({
  ...DEFAULT_ANNOTATION_STYLE,
  ...readStoredTextDefaults(),
  recentColors: loadRecentColors(),
  magnifierZoom: 2,
  magnifierBorderColor: '#FFFFFF',
  magnifierRoiColor: loadRoiColor(),
  magnifierConnector: true,

  setStyle: (patch) => {
    set(patch as Partial<StyleState>);
    if (patch.fontFamily !== undefined || patch.fontSize !== undefined) {
      const current = useStyle.getState();
      persistTextDefaults(current.chineseFontFamily, current.englishFontFamily, current.fontSize);
    }
  },
  setFontPair: (patch) => {
    set((state) => {
      const chineseFontFamily = patch.chineseFontFamily ?? state.chineseFontFamily;
      const englishFontFamily = patch.englishFontFamily ?? state.englishFontFamily;
      const fontFamily = makeTextFontFamily(englishFontFamily, chineseFontFamily);
      persistTextDefaults(chineseFontFamily, englishFontFamily, state.fontSize);
      return { chineseFontFamily, englishFontFamily, fontFamily };
    });
  },
  useColor: (color) => set({ stroke: color, recentColors: pushRecentColor(color) }),
  setMagnifier: (patch) => {
    if (patch.roiColor) saveRoiColor(patch.roiColor);
    set((s) => ({
      magnifierZoom: patch.zoom ?? s.magnifierZoom,
      magnifierBorderColor: patch.borderColor ?? s.magnifierBorderColor,
      magnifierRoiColor: patch.roiColor ?? s.magnifierRoiColor,
      magnifierConnector: patch.connector ?? s.magnifierConnector,
    }));
  },
}));
