import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import es from './locales/es.json';
import en from './locales/en.json';
import tr from './locales/tr.json';
import zhCN from './locales/zh-CN.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';

export const LANGUAGES = [
  { code: 'es', label: 'Español' },
  { code: 'en', label: 'English' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'zh-CN', label: '简体中文' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
] as const;

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      es: { translation: es },
      en: { translation: en },
      tr: { translation: tr },
      'zh-CN': { translation: zhCN },
      ja: { translation: ja },
      ko: { translation: ko },
    },
    supportedLngs: LANGUAGES.map((l) => l.code),
    fallbackLng: 'es',
    interpolation: { escapeValue: false },
  });

// Mantiene el atributo lang del documento (accesibilidad y selección de fuentes CJK).
i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
});

export default i18n;
