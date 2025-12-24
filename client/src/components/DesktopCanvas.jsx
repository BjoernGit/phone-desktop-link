import React from "react";
import { PhotoGrid } from "./PhotoGrid";

export function DesktopCanvas({ photos, onSelect, onCopy, onSave, onCopyPlain, onCopyEncrypted, showDebug }) {
  if (photos.length === 0) {
    return (
      <div className="emptyInvite">
        <div className="emptyCallout">Bereit, Fotos zu empfangen</div>
        <div className="emptyHint">Scanne den QR-Code mit deinem Handy und tippe auf den Auslöser.</div>
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
