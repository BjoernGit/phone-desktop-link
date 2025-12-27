import React from "react";
import { useTranslation } from "react-i18next";
import heroLogo from "../assets/Snap2Desk_Text_Logo.png";

export function DesktopHero() {
  const { t } = useTranslation();

  return (
    <header className="desktopHero">
      <div className="heroCopy">
        <img className="heroLogo" src={heroLogo} alt="Snap2Desk Logo" />
        <div className="heroSub">{t("desktop.hero.tagline")}</div>
      </div>
    </header>
  );
}
