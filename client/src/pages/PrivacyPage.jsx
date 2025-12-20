import { FooterBar } from "../components/FooterBar";
import heroLogo from "../assets/Snap2Desk_Text_Logo.png";

export function PrivacyContent() {
  return (
    <>
      <h2>1. Allgemeines</h2>
      <p>
        Der Schutz Ihrer pers&ouml;nlichen Daten ist dem Betreiber dieser Website ein wichtiges Anliegen.
        Diese Website kann grunds&auml;tzlich <strong>ohne Konto und ohne aktive Eingabe personenbezogener Daten</strong> genutzt werden.
      </p>

      <hr />

      <h2>2. Verarbeitung personenbezogener Daten</h2>
      <p>
        Es werden <strong>keine Benutzerkonten gef&uuml;hrt und keine Daten dauerhaft gespeichert</strong>.
        Technisch notwendig ist die kurzzeitige Verarbeitung folgender Verbindungsdaten:
      </p>
      <ul>
        <li>IP-Adresse f&uuml;r die Dauer der Verbindung</li>
        <li>Sitzungskennung (sessionId) und Ger&auml;tename zum Koppeln der Ger&auml;te</li>
      </ul>
      <p>Diese Daten werden ausschlie&szlig;lich fl&uuml;chtig verarbeitet und nicht persistiert.</p>
      <p>
        Es kommen <strong>keine Analyse- oder Tracking-Tools</strong> zum Einsatz und es werden
        <strong>keine Cookies f&uuml;r Marketing- oder Analysezwecke</strong> gesetzt.
      </p>

      <hr />

      <h2>3. &Uuml;bertragene Inhalte (Fotos)</h2>
      <p>
        Fotos, die &uuml;ber diese Website &uuml;bertragen werden, dienen ausschlie&szlig;lich der
        <strong> tempor&auml;ren &Uuml;bertragung zwischen verbundenen Ger&auml;ten</strong>.
      </p>
      <ul>
        <li>Die &uuml;bertragenen Daten werden <strong>nicht dauerhaft gespeichert</strong>.</li>
        <li>Es erfolgt <strong>keine Weitergabe an Dritte</strong> (au&szlig;er an die von Ihnen verbundene Gegenstelle).</li>
        <li>Die &Uuml;bertragung erfolgt <strong>Ende-zu-Ende-verschl&uuml;sselt</strong>; der Server sieht nur chiffrierte Nutzlasten.</li>
      </ul>
    </>
  );
}

export function PageShell({ title, children }) {
  return (
    <div className="desktopShell legalPage">
      <header className="desktopHero legalHero">
        <div className="heroCopy">
          <img className="heroLogo" src={heroLogo} alt="Snap2Desk Logo" />
          <div className="heroSub">
            Pics from your phone straight to your desktop. Fast, simple, safe, without an account.
          </div>
        </div>
      </header>

      <div className="legalContent">
        <h1>{title}</h1>
        <div className="legalText">{children}</div>
      </div>

      <FooterBar onToggleDebug={() => {}} />
    </div>
  );
}

export default function PrivacyPage() {
  return (
    <PageShell title="Datenschutz">
      <PrivacyContent />
    </PageShell>
  );
}
