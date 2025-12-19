export function DebugPanel({ value, onChange, onAdd, status, metrics }) {
  return (
    <div className="debugPanel">
      <label className="debugLabel" htmlFor="debugDataUrl">
        Debug Data-URL einfuegen
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
          Add
        </button>
      </div>
      {(status || metrics) && (
        <div className="debugStatus">
          {status}
          {status && metrics ? " • " : ""}
          {metrics}
        </div>
      )}
    </div>
  );
}
