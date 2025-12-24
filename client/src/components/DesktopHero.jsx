import React from "react";
import heroLogo from "../assets/Snap2Desk_Text_Logo.png";

export function DesktopHero() {
  return (
    <header className="desktopHero">
      <div className="heroCopy">
        <img className="heroLogo" src={heroLogo} alt="Snap2Desk Logo" />
        <div className="heroSub">
          Fotos vom Handy direkt auf deinen Desktop. Schnell, einfach, sicher - ganz ohne Account.
        </div>
      </div>
    </header>
  );
}
