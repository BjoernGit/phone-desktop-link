import { useState } from "react";

export function Lightbox({ src, onClose, onCopy, onSave, showDebug, onCopyPlain, onCopyEncrypted, actions }) {
  const [dim, setDim] = useState("");
  if (!src) return null;
  return (
    <div className="lightbox" onClick={onClose}>
      <img
        className="lightboxImg"
        src={src}
        alt="Vergroessertes Foto"
        onLoad={(e) => {
          const w = e.currentTarget.naturalWidth;
          const h = e.currentTarget.naturalHeight;
          if (w && h) setDim(`${w}x${h}`);
        }}
      />
      {dim && (
        <div className="lightboxMeta">
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
              Copy
            </button>
            <button
              type="button"
              className="overlayBtn"
              onClick={(e) => {
                e.stopPropagation();
                onSave?.(src);
              }}
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
          </>
        )}
      </div>
    </div>
  );
}
