import { PageShell } from "./PrivacyPage";

export default function ImpressumPage() {
  return (
    <PageShell title="Impressum">
      <h2>Betreiber der Website</h2>
      <p>
        Bj&ouml;rn Glienke<br />
        Erlenmattstrasse 79<br />
        4058 Basel-Stadt<br />
        Schweiz
      </p>
      <p>
        <strong>E-Mail:</strong><br />
        <a href="mailto:kontakt@snap2desk.com">kontakt@snap2desk.com</a>
      </p>

      <hr />

      <h2>Haftungsausschluss</h2>
      <p>
        Der Betreiber &uuml;bernimmt keine Gew&auml;hr f&uuml;r die Richtigkeit, Vollst&auml;ndigkeit und Aktualit&auml;t der
        bereitgestellten Inhalte. Haftungsanspr&uuml;che gegen den Betreiber wegen Sch&auml;den materieller oder immaterieller Art, die
        aus dem Zugriff oder der Nutzung bzw. Nichtnutzung der ver&ouml;ffentlichten Informationen entstanden sind, werden ausgeschlossen.
      </p>

      <hr />

      <h2>Haftung f&uuml;r Links</h2>
      <p>
        Diese Website kann Links zu externen Websites Dritter enthalten, auf deren Inhalte kein Einfluss besteht. F&uuml;r diese fremden
        Inhalte wird keine Gew&auml;hr &uuml;bernommen. F&uuml;r die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter oder
        Betreiber der Seiten verantwortlich.
      </p>
    </PageShell>
  );
}
