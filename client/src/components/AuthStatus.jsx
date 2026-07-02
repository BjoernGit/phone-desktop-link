import React from "react";
import { useTranslation } from "react-i18next";

export function AuthStatus({ isConfigured, isLoading, user, error, onLogin, onLogout, compact = false }) {
  const { t } = useTranslation();
  const containerClass = `authStatus${compact ? " compact" : ""}`;

  if (!isConfigured) {
    return <div className={`${containerClass} warn`}>{t("auth.notConfigured")}</div>;
  }

  return (
    <div className={containerClass}>
      {isLoading ? (
        <span className="authMeta">{t("auth.loading")}</span>
      ) : user ? (
        <>
          <span className="authMeta">
            {t("auth.signedInAs", { email: user.email || t("auth.unknownUser") })}
          </span>
          <button type="button" className="authButton ghost" onClick={onLogout}>
            {t("auth.signOut")}
          </button>
        </>
      ) : (
        <button type="button" className="authButton" onClick={onLogin}>
          {t("auth.signInGoogle")}
        </button>
      )}
      {error ? <span className="authError">{error}</span> : null}
    </div>
  );
}
