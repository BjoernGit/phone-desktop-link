import React from "react";
import { useTranslation } from "react-i18next";
import { PhotoGrid } from "./PhotoGrid";

export function DesktopCanvas({ photos, onSelect, onCopy, onSave, onCopyPlain, onCopyEncrypted, showDebug }) {
  const { t } = useTranslation();

  if (photos.length === 0) {
    return (
      <div className="emptyInvite">
        <div className="emptyCallout">{t("desktop.canvas.ready")}</div>
        <div className="emptyHint">{t("desktop.canvas.hint")}</div>
      </div>
    );
  }
  return (
    <PhotoGrid
      photos={photos}
      onSelect={onSelect}
      onCopy={onCopy}
      onSave={onSave}
      showDebug={showDebug}
      onCopyPlain={onCopyPlain}
      onCopyEncrypted={onCopyEncrypted}
    />
  );
}
