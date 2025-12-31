import { useTranslation } from "react-i18next";

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
