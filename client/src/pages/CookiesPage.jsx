import { useTranslation } from "react-i18next";

export function CookiesContent() {
  const { t } = useTranslation();

  return (
    <>
      <h2 dangerouslySetInnerHTML={{ __html: t("legal.cookies.general.heading") }} />
      <p dangerouslySetInnerHTML={{ __html: t("legal.cookies.general.noCookies") }} />
      <p dangerouslySetInnerHTML={{ __html: t("legal.cookies.general.explanation") }} />

      <hr />

      <h2 dangerouslySetInnerHTML={{ __html: t("legal.cookies.currentStatus.heading") }} />
      <ul>
        <li dangerouslySetInnerHTML={{ __html: t("legal.cookies.currentStatus.item1") }} />
        <li dangerouslySetInnerHTML={{ __html: t("legal.cookies.currentStatus.item2") }} />
        <li dangerouslySetInnerHTML={{ __html: t("legal.cookies.currentStatus.item3") }} />
      </ul>
      <p dangerouslySetInnerHTML={{ __html: t("legal.cookies.currentStatus.summary") }} />

      <hr />

      <h2 dangerouslySetInnerHTML={{ __html: t("legal.cookies.futureUse.heading") }} />
      <p dangerouslySetInnerHTML={{ __html: t("legal.cookies.futureUse.text") }} />

      <hr />

      <h2 dangerouslySetInnerHTML={{ __html: t("legal.cookies.contact.heading") }} />
      <p>
        {t("legal.cookies.contact.intro")}
        <br />
        <strong>{t("legal.cookies.contact.email")}</strong>{" "}
        <a href={`mailto:${t("legal.cookies.contact.emailAddress")}`}>
          {t("legal.cookies.contact.emailAddress")}
        </a>
      </p>
    </>
  );
}
