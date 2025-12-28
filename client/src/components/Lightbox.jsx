import { useState } from "react";
import { useTranslation } from "react-i18next";

export function Lightbox({ src, onClose, onCopy, onSave, showDebug, onCopyPlain, onCopyEncrypted, actions }) {
  const { t } = useTranslation();
  const [dim, setDim] = useState("");
  if (!src) return null;
  return (
    <div className="lightbox">
      <div className="lightboxBackdrop" onClick={onClose} />
      <img
        className="lightboxImg"
        src={src}
        alt={t("lightbox.altText")}
        onLoad={(e) => {
          const w = e.currentTarget.naturalWidth;
          const h = e.currentTarget.naturalHeight;
          if (w && h) setDim(`${w}x${h}`);
        }}
        onClick={(e) => e.stopPropagation()}
      />
      {dim && (
        <div className="lightboxMeta" onClick={(e) => e.stopPropagation()}>
          <span className="metaBadge">{dim}</span>
        </div>
      )}
      <div className="lightboxActions">
        {actions ? (
          actions
        ) : (
          <>
            <button
              type="button"
              className="overlayBtn"
              onClick={(e) => {
                e.stopPropagation();
                onCopy?.(src);
              }}
            >
              {t("common.buttons.copy")}
            </button>
            <button
              type="button"
              className="overlayBtn"
              onClick={(e) => {
                e.stopPropagation();
                onSave?.(src);
              }}
            >
              {t("common.buttons.save")}
            </button>
            {showDebug && (
              <>
                <button
                  type="button"
                  className="overlayBtn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCopyPlain?.(src);
                  }}
                >
                  {t("common.buttons.copyUrl")}
                </button>
                <button
                  type="button"
                  className="overlayBtn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCopyEncrypted?.(src);
                  }}
                >
                  {t("common.buttons.copyEnc")}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
