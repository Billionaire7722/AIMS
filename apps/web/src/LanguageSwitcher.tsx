import { useLanguage } from "./i18n";

type Props = {
  compact?: boolean;
};

export function LanguageSwitcher({ compact = false }: Props) {
  const { language, setLanguage, t } = useLanguage();

  return (
    <div className={`language-switcher ${compact ? "compact" : ""}`}>
      <span className="language-switcher-label">{t.common.languageLabel}</span>
      <div className="language-switcher-options" role="group" aria-label={t.common.languageLabel}>
        <button
          type="button"
          className={language === "vi" ? "active" : ""}
          aria-pressed={language === "vi"}
          onClick={() => setLanguage("vi")}
        >
          {t.common.languageOptions.vi}
        </button>
        <button
          type="button"
          className={language === "en" ? "active" : ""}
          aria-pressed={language === "en"}
          onClick={() => setLanguage("en")}
        >
          {t.common.languageOptions.en}
        </button>
      </div>
    </div>
  );
}
