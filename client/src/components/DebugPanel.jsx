import { useTranslation } from "react-i18next";

export function DebugPanel({
  value,
  onChange,
  onAdd,
  status,
  metrics,
  seedValue,
  onSeedChange,
  offerStatus,
}) {
  const { t } = useTranslation();
  return (
    <div className="debugPanel">
      <label className="debugLabel" htmlFor="debugDataUrl">
        {t("debug.insertDataUrl")}
      </label>

      <div className="debugControls">
        <textarea
          id="debugDataUrl"
          className="debugInput"
          placeholder="data:image/jpeg;base64,..."
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
        />
        <button type="button" className="debugBtn" onClick={onAdd}>
          {t("common.buttons.add")}
        </button>
      </div>

      {typeof seedValue !== "undefined" && onSeedChange && (
        <div className="debugSeedRow">
          <label className="debugLabel" htmlFor="debugSeed">
            {t("debug.seedLabel")}
          </label>
          <input
            id="debugSeed"
            className="debugSeedInput"
            value={seedValue}
            onChange={(e) => onSeedChange(e.target.value)}
            placeholder="seed"
          />
        </div>
      )}

      {(status || metrics || offerStatus) && (
        <div className="debugStatus">
          {status}
          {status && metrics ? " · " : ""}
          {metrics}
        </div>
      )}
      {offerStatus && (
        <div className="debugStatus">
          Offer: {offerStatus}
        </div>
      )}
    </div>
  );
}
