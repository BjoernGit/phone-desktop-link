import React from "react";

const QUALITY_OPTIONS = [
  { id: "S", label: "S (360 x 640)" },
  { id: "M", label: "M (720 x 1280)" },
  { id: "L", label: "L (1080 x 1920)" },
  { id: "XL", label: "XL (1440 x 2560)" },
];

export function QualityPicker({ quality, open, onToggle, onSelect, options = QUALITY_OPTIONS, labelPrefix = "Aufloesung" }) {
  return (
    <div className="qualityPickerWrap">
      <button
        type="button"
        className="qualityToggle"
        onClick={(e) => {
          e.stopPropagation();
          onToggle?.();
        }}
      >
        {labelPrefix}: {quality}
      </button>
      {open && (
        <div className="qualityMenu" onClick={(e) => e.stopPropagation()}>
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`qualityItem ${quality === opt.id ? "active" : ""}`}
              onClick={() => onSelect?.(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
