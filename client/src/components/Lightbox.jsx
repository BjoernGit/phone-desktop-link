export function Lightbox({ src, onClose, onCopy, onSave }) {
  if (!src) return null;
  return (
    <div className="lightbox" onClick={onClose}>
      <img className="lightboxImg" src={src} alt="Vergroessertes Foto" />
      <div className="lightboxActions">
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
      </div>
    </div>
  );
}
