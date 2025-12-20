import { Link } from "react-router-dom";
import { PageShell } from "./PrivacyPage";

export default function NotFoundPage() {
  return (
    <PageShell title="Seite nicht gefunden">
      <p>Die angeforderte Seite existiert nicht.</p>
      <p>
        <Link to="/">Zur&uuml;ck zur Startseite</Link>
      </p>
    </PageShell>
  );
}
