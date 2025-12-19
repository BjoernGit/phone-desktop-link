export function PhotoGrid({ photos, onSelect, onCopy, onSave }) {
  if (!photos || photos.length === 0) return null;

  return (
    <div className="photoGrid">
      {photos.map((src, idx) => (
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
          <img className="photoImg" src={src} alt={`Photo ${idx}`} />
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
          </div>
        </div>
      ))}
    </div>
  );
}
