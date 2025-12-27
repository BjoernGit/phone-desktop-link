import React from "react";
import { useTranslation } from "react-i18next";

export function PendingApprovals({ pending, onApprove, onReject }) {
  const { t } = useTranslation();
  if (!pending || pending.length === 0) return null;
  return (
    <div className="pendingApprovals">
      {pending.map((id) => {
        const shortId = id.slice(0, 6);
        return (
          <div key={id} className="sessionOfferBar pendingBar">
            <div className="sessionOfferText">
              <code className="offerSender">{shortId}</code> {t("offer.wantsToJoin", { device: "" })}
            </div>
            <div className="sessionOfferActions">
              <button type="button" className="sessionOfferBtn ghost" onClick={() => onReject?.(id)}>
                {t("common.buttons.reject")}
              </button>
              <button type="button" className="sessionOfferBtn" onClick={() => onApprove?.(id)}>
                {t("common.buttons.approve")}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
