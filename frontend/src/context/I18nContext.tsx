import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import en from '@/locales/en.json';
import ar from '@/locales/ar.json';

export type Language = 'ar' | 'en';

const LANGUAGE_STORAGE_KEY = 'learnflow-language';

const translations = { en, ar } as const;
type TranslationTree = typeof en;
export type TranslationKey = {
  [Domain in keyof TranslationTree]: `${Domain & string}.${keyof TranslationTree[Domain] & string}`
}[keyof TranslationTree] | 'delete_confirm';
export type TranslationParams = Record<string, string | number | boolean | null | undefined>;
type I18nContextValue = {
  language: Language;
  direction: 'rtl' | 'ltr';
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
  t: (key: TranslationKey, params?: TranslationParams) => string;
  formatNumber: (value: number) => string;
  formatCurrency: (value: number, currency?: string) => string;
  formatDate: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => string;
};

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export function resolveInitialLanguage(): Language {
  if (typeof window === 'undefined') return 'en';
  const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (saved === 'ar' || saved === 'en') return saved;
  return window.navigator.language.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

export function applyLanguageToDocument(language: Language) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = language;
  document.documentElement.dir = 'ltr';
}

export function I18nProvider({ children, initialLanguage = resolveInitialLanguage() }: { children: ReactNode; initialLanguage?: Language }) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  useEffect(() => {
    applyLanguageToDocument(language);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  const value = useMemo<I18nContextValue>(() => ({
    language,
    direction: 'ltr',
    setLanguage: (nextLanguage) => setLanguageState(nextLanguage),
    toggleLanguage: () => setLanguageState((current) => current === 'ar' ? 'en' : 'ar'),
    t: (key, params) => {
      const [domain, name] = key.includes('.') ? key.split('.') as [keyof TranslationTree, string] : ['common', key] as [keyof TranslationTree, string];
      const message = String(translations[language][domain][name as never] ?? key);
      return params ? message.replace(/\{\{?(\w+)\}?\}/g, (placeholder, parameterName: string) => params[parameterName] == null ? placeholder : String(params[parameterName])) : message;
    },
    formatNumber: (value) => new Intl.NumberFormat(language === 'ar' ? 'ar-EG' : 'en-US').format(value),
    formatCurrency: (value, currency = 'USD') => new Intl.NumberFormat(language === 'ar' ? 'ar-EG' : 'en-US', { style: 'currency', currency }).format(value),
    formatDate: (value, options) => new Intl.DateTimeFormat(language === 'ar' ? 'ar-EG' : 'en-US', options).format(new Date(value)),
  }), [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used within I18nProvider.');
  return context;
}

export function useTranslation() {
  const { t, ...helpers } = useI18n();
  return { t, ...helpers };
}
