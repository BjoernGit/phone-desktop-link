export function FooterBar({ onToggleDebug }) {
  return (
    <footer className="footer">
      <div className="footerInner">
        <div className="footerMeta">(c) 2025 Snap2Desk. Alle Rechte vorbehalten.</div>
        <div className="footerLinks">
          <button type="button" className="footerLinkBtn" onClick={onToggleDebug}>
            Debug
          </button>
          <span>-</span>
          <a href="#" aria-label="Datenschutz">Datenschutz</a>
          <span>-</span>
          <a href="#" aria-label="Cookies">Cookies</a>
          <span>-</span>
          <a href="#" aria-label="Nutzungsbedingungen">Nutzungsbedingungen</a>
          <span>-</span>
          <a href="#" aria-label="Impressum">Impressum</a>
          <span>-</span>
          <a href="#" aria-label="Support">Support</a>
        </div>
        <div className="footerLocale">Schweiz</div>
      </div>
    </footer>
  );
}
