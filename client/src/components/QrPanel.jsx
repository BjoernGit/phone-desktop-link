import { QRCodeSVG } from "qrcode.react";

export function QrPanel({ value, size = 240, label, className = "" }) {
  const classes = ["qrPanel", className].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      {label && <div className="qrLabel">{label}</div>}
      <div className="qrWrap">
        <QRCodeSVG value={value} size={size} />
      </div>
    </div>
  );
}
