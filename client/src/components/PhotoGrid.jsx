import { useState } from "react";
import { useTranslation } from "react-i18next";

export function PhotoGrid({ photos, onSelect, onCopy, onSave, showDebug, onCopyPlain, onCopyEncrypted }) {
  const { t } = useTranslation();
  const [dimMap, setDimMap] = useState({});
  if (!photos || photos.length === 0) return null;

  return (
    <div className="photoGrid">
      {photos.map((src, idx) => {
        const label = dimMap[src] || "";
        return (
          <div
            key={idx}
            className="photoCard"
            role="button"
            tabIndex={0}
            onClick={() => onSelect?.(src)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect?.(src);
              }
            }}
            aria-label={t("common.aria.viewPhoto", { idx: idx + 1 })}
          >
            <img
              className="photoImg"
              src={src}
              alt={`Photo ${idx}`}
              onLoad={(e) => {
                const w = e.currentTarget.naturalWidth;
                const h = e.currentTarget.naturalHeight;
                if (w && h && !dimMap[src]) {
                  setDimMap((prev) => ({ ...prev, [src]: `${w}x${h}` }));
                }
              }}
            />
            {label && (
              <div className="cardMeta">
                <span className="metaBadge">{label}</span>
              </div>
            )}
            <div className="cardOverlay">
              <button
                type="button"
                className="overlayBtn"
                onClick={(e) => {
                  e.stopPropagation();
                  onCopy?.(src);
                }}
                aria-label={t("common.aria.copyToClipboard")}
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
                aria-label={t("common.aria.saveImage")}
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
            </div>
          </div>
        );
      })}
    </div>
  );
}
