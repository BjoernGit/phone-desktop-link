import React from "react";
import { useTranslation } from "react-i18next";

export function LanguageToggle() {
  const { i18n } = useTranslation();
  const currentLang = i18n.language?.startsWith("de") ? "de" : "en";

  const toggleLanguage = () => {
    const newLang = currentLang === "de" ? "en" : "de";
    i18n.changeLanguage(newLang);
  };

  return (
    <button
      type="button"
      onClick={toggleLanguage}
      className="languageToggle"
      aria-label="Toggle language"
      title={currentLang === "de" ? "Auf Deutsch wechseln" : "Switch to English"}
    >
      {currentLang === "de" ? (
        <>
          <span className="flag">🇩🇪</span>
          <span className="langText">Deutsch</span>
        </>
      ) : (
        <>
          <span className="flag">🇬🇧</span>
          <span className="langText">English</span>
        </>
      )}
    </button>
  );
}
