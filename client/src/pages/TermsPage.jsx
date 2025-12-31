import { useTranslation } from "react-i18next";

export function TermsContent() {
  const { t } = useTranslation();

  return (
    <>
      <h2 dangerouslySetInnerHTML={{ __html: t("legal.terms.scope.heading") }} />
      <p dangerouslySetInnerHTML={{ __html: t("legal.terms.scope.text") }} />

      <hr />

      <h2 dangerouslySetInnerHTML={{ __html: t("legal.terms.serviceDescription.heading") }} />
      <p dangerouslySetInnerHTML={{ __html: t("legal.terms.serviceDescription.text") }} />

      <hr />

      <h2 dangerouslySetInnerHTML={{ __html: t("legal.terms.ownResponsibility.heading") }} />
      <p dangerouslySetInnerHTML={{ __html: t("legal.terms.ownResponsibility.intro") }} />
      <ul>
        <li dangerouslySetInnerHTML={{ __html: t("legal.terms.ownResponsibility.item1") }} />
        <li dangerouslySetInnerHTML={{ __html: t("legal.terms.ownResponsibility.item2") }} />
        <li dangerouslySetInnerHTML={{ __html: t("legal.terms.ownResponsibility.item3") }} />
      </ul>

      <hr />

      <h2 dangerouslySetInnerHTML={{ __html: t("legal.terms.prohibitedUse.heading") }} />
      <p dangerouslySetInnerHTML={{ __html: t("legal.terms.prohibitedUse.intro") }} />
      <ul>
        <li dangerouslySetInnerHTML={{ __html: t("legal.terms.prohibitedUse.item1") }} />
        <li dangerouslySetInnerHTML={{ __html: t("legal.terms.prohibitedUse.item2") }} />
        <li dangerouslySetInnerHTML={{ __html: t("legal.terms.prohibitedUse.item3") }} />
      </ul>

      <hr />

      <h2 dangerouslySetInnerHTML={{ __html: t("legal.terms.liability.heading") }} />
      <p dangerouslySetInnerHTML={{ __html: t("legal.terms.liability.text") }} />

      <hr />

      <h2 dangerouslySetInnerHTML={{ __html: t("legal.terms.changes.heading") }} />
      <p dangerouslySetInnerHTML={{ __html: t("legal.terms.changes.text") }} />

      <hr />

      <h2 dangerouslySetInnerHTML={{ __html: t("legal.terms.law.heading") }} />
      <p dangerouslySetInnerHTML={{ __html: t("legal.terms.law.text") }} />
    </>
  );
}
