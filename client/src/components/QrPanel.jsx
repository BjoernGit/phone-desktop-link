import { forwardRef } from "react";
import { QRCodeSVG } from "qrcode.react";

export const QrPanel = forwardRef(function QrPanel({ value, size = 240, label, className = "" }, ref) {
  const classes = ["qrPanel", className].filter(Boolean).join(" ");
  return (
    <div className={classes} ref={ref}>
      {label && <div className="qrLabel">{label}</div>}
      <div className="qrWrap">
        <QRCodeSVG value={value} size={size} />
      </div>
    </div>
  );
});
