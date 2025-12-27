import { useTranslation } from "react-i18next";
import { PageShell } from "./PrivacyPage";

export function ImpressumContent() {
  const { t } = useTranslation();

  return (
    <>
      <h2 dangerouslySetInnerHTML={{ __html: t("legal.impressum.operator.heading") }} />
      <p>
        {t("legal.impressum.operator.name")}
        <br />
        {t("legal.impressum.operator.address1")}
        <br />
        {t("legal.impressum.operator.address2")}
        <br />
        {t("legal.impressum.operator.country")}
      </p>
      <p>
        <strong>{t("legal.impressum.operator.email")}</strong>
        <br />
        <a href={`mailto:${t("legal.impressum.operator.emailAddress")}`}>
          {t("legal.impressum.operator.emailAddress")}
        </a>
      </p>

      <hr />

      <h2 dangerouslySetInnerHTML={{ __html: t("legal.impressum.disclaimer.heading") }} />
      <p dangerouslySetInnerHTML={{ __html: t("legal.impressum.disclaimer.text") }} />

      <hr />

      <h2 dangerouslySetInnerHTML={{ __html: t("legal.impressum.linksLiability.heading") }} />
      <p dangerouslySetInnerHTML={{ __html: t("legal.impressum.linksLiability.text") }} />
    </>
  );
}

export default function ImpressumPage() {
  const { t } = useTranslation();

  return (
    <PageShell title={t("legal.impressum.title")}>
      <ImpressumContent />
    </PageShell>
  );
}
