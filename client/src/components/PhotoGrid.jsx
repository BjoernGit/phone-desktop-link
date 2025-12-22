import { useState } from "react";

export function PhotoGrid({ photos, onSelect, onCopy, onSave, showDebug, onCopyPlain, onCopyEncrypted }) {
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
            aria-label={`Foto ${idx + 1} ansehen`}
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
                aria-label="In Zwischenablage kopieren"
              >
                Copy
              </button>
              <button
                type="button"
                className="overlayBtn"
                onClick={(e) => {
                  e.stopPropagation();
                  onSave?.(src);
                }}
                aria-label="Speichern"
              >
                Save
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
                    Copy URL
                  </button>
                  <button
                    type="button"
                    className="overlayBtn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCopyEncrypted?.(src);
                    }}
                  >
                    Copy Enc
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
