import { PageShell } from "./PrivacyPage";

export function CookiesContent() {
  return (
    <>
      <h2>1. Allgemeines</h2>
      <p>Diese Website verwendet derzeit <strong>keine Cookies</strong>.</p>
      <p>
        Cookies sind kleine Textdateien, die auf Ihrem Endger&auml;t gespeichert werden und bestimmte Informationen enthalten k&ouml;nnen.
        Sie dienen h&auml;ufig dazu, Websites benutzerfreundlicher, effektiver und sicherer zu machen.
      </p>

      <hr />

      <h2>2. Aktueller Stand</h2>
      <ul>
        <li>❌ Es werden <strong>keine Cookies</strong> gesetzt</li>
        <li>❌ Es werden <strong>keine Tracking- oder Analyse-Tools</strong> eingesetzt</li>
        <li>❌ Es findet <strong>kein Nutzer-Tracking</strong> statt</li>
      </ul>
      <p>Die Nutzung dieser Website ist vollst&auml;ndig <strong>ohne Cookies</strong> m&ouml;glich.</p>

      <hr />

      <h2>3. Zuk&uuml;nftige Nutzung von Cookies</h2>
      <p>
        Sollten in Zukunft Cookies eingesetzt werden (z. B. f&uuml;r funktionale Zwecke oder optionale Erweiterungen), wird diese
        Cookie-Richtlinie entsprechend angepasst. Erforderliche Einwilligungen werden dann vor dem Setzen entsprechender Cookies eingeholt.
      </p>

      <hr />

      <h2>4. Kontakt</h2>
      <p>
        Bei Fragen zur Verwendung von Cookies auf dieser Website k&ouml;nnen Sie sich jederzeit an den Betreiber wenden:
        <br />
        <strong>E-Mail:</strong> <a href="mailto:kontakt@snap2desk.com">kontakt@snap2desk.com</a>
      </p>
    </>
  );
}

export default function CookiesPage() {
  return (
    <PageShell title="Cookies">
      <CookiesContent />
    </PageShell>
  );
}
