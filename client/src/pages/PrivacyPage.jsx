import { useTranslation } from "react-i18next";
import { FooterBar } from "../components/FooterBar";
import heroLogo from "../assets/Snap2Desk_Text_Logo.png";

export function PrivacyContent() {
  const { t } = useTranslation();

  return (
    <>
      <h2 dangerouslySetInnerHTML={{ __html: t("legal.privacy.general.heading") }} />
      <p dangerouslySetInnerHTML={{ __html: t("legal.privacy.general.text") }} />

      <hr />

      <h2 dangerouslySetInnerHTML={{ __html: t("legal.privacy.dataProcessing.heading") }} />
      <p dangerouslySetInnerHTML={{ __html: t("legal.privacy.dataProcessing.intro") }} />
      <ul>
        <li dangerouslySetInnerHTML={{ __html: t("legal.privacy.dataProcessing.item1") }} />
        <li dangerouslySetInnerHTML={{ __html: t("legal.privacy.dataProcessing.item2") }} />
      </ul>
      <p dangerouslySetInnerHTML={{ __html: t("legal.privacy.dataProcessing.volatile") }} />
      <p dangerouslySetInnerHTML={{ __html: t("legal.privacy.dataProcessing.noTracking") }} />

      <hr />

      <h2 dangerouslySetInnerHTML={{ __html: t("legal.privacy.transferredContent.heading") }} />
      <p dangerouslySetInnerHTML={{ __html: t("legal.privacy.transferredContent.intro") }} />
      <ul>
        <li dangerouslySetInnerHTML={{ __html: t("legal.privacy.transferredContent.item1") }} />
        <li dangerouslySetInnerHTML={{ __html: t("legal.privacy.transferredContent.item2") }} />
        <li dangerouslySetInnerHTML={{ __html: t("legal.privacy.transferredContent.item3") }} />
      </ul>
    </>
  );
}

export function PageShell({ title, children }) {
  const { t } = useTranslation();

  return (
    <div className="desktopShell legalPage">
      <header className="desktopHero legalHero">
        <div className="heroCopy">
          <img className="heroLogo" src={heroLogo} alt="Snap2Desk Logo" />
          <div className="heroSub">{t("legal.pageShell.heroTagline")}</div>
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
  const { t } = useTranslation();

  return (
    <PageShell title={t("legal.privacy.title")}>
      <PrivacyContent />
    </PageShell>
  );
}
