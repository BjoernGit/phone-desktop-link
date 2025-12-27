import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageToggle } from "./LanguageToggle";

export function FooterBar({ onToggleDebug }) {
  const { t } = useTranslation();

  return (
    <footer className="footer">
      <div className="footerInner">
        <div className="footerMeta">{t("footer.copyright")}</div>
        <div className="footerLinks">
          {typeof onToggleDebug === "function" ? (
            <>
              <button type="button" className="footerLinkBtn" onClick={onToggleDebug}>
                {t("footer.debug")}
              </button>
              <span>-</span>
            </>
          ) : null}
          <Link to="/datenschutz" aria-label={t("footer.privacy")}>
            {t("footer.privacy")}
          </Link>
          <span>-</span>
          <Link to="/cookies" aria-label={t("footer.cookies")}>
            {t("footer.cookies")}
          </Link>
          <span>-</span>
          <Link to="/agb" aria-label={t("footer.terms")}>
            {t("footer.terms")}
          </Link>
          <span>-</span>
          <Link to="/impressum" aria-label={t("footer.impressum")}>
            {t("footer.impressum")}
          </Link>
        </div>
        <div className="footerLocale">
          <LanguageToggle />
        </div>
      </div>
    </footer>
  );
}
