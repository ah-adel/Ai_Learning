import { useI18n } from '@/context/I18nContext';

interface LanguageToggleProps {
  className?: string;
}

export function LanguageToggle({ className = '' }: LanguageToggleProps) {
  const { language, toggleLanguage, t } = useI18n();

  return (
    <button
      type="button"
      onClick={toggleLanguage}
      className={`language-toggle ${className}`}
      aria-label={t('common.language')}
      title={t('common.language')}
    >
      <span className={language === 'ar' ? 'language-toggle__option language-toggle__option--active' : 'language-toggle__option'}>
        ع
      </span>
      <span className={language === 'en' ? 'language-toggle__option language-toggle__option--active' : 'language-toggle__option'}>
        EN
      </span>
    </button>
  );
}
