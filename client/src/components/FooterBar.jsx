import { Link } from "react-router-dom";

export function FooterBar({ onToggleDebug = () => {} }) {
  return (
    <footer className="footer">
      <div className="footerInner">
        <div className="footerMeta">(c) 2025 Snap2Desk. Alle Rechte vorbehalten.</div>
        <div className="footerLinks">
          <button type="button" className="footerLinkBtn" onClick={onToggleDebug}>
            Debug
          </button>
          <span>-</span>
          <Link to="/datenschutz" aria-label="Datenschutz">
            Datenschutz
          </Link>
          <span>-</span>
          <Link to="/cookies" aria-label="Cookies">
            Cookies
          </Link>
          <span>-</span>
          <Link to="/agb" aria-label="Nutzungsbedingungen">
            Nutzungsbedingungen
          </Link>
          <span>-</span>
          <Link to="/impressum" aria-label="Impressum">
            Impressum
          </Link>
        </div>
        <div className="footerLocale">Schweiz</div>
      </div>
    </footer>
  );
}
