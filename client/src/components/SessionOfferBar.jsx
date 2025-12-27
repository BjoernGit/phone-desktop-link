import React from "react";
import { useTranslation } from "react-i18next";

export function SessionOfferBar({ offer, onAccept, onDecline }) {
  const { t } = useTranslation();
  if (!offer) return null;
  const senderId = offer.fromUuid ? offer.fromUuid.slice(0, 6) : null;
  const message = offer.isJoin ? t("offer.wantsToJoin", { device: "" }) : t("offer.invitesYou", { device: "" });

  return (
    <div className="sessionOfferBar">
      <div className="sessionOfferText">
        {senderId ? (
          <>
            <code className="offerSender">{senderId}</code> {message}
          </>
        ) : (
          t("offer.newRequest")
        )}
      </div>
      <div className="sessionOfferActions">
        <button type="button" className="sessionOfferBtn ghost" onClick={onDecline}>
          {t("common.buttons.decline")}
        </button>
        <button type="button" className="sessionOfferBtn" onClick={onAccept}>
          {t("common.buttons.join")}
        </button>
      </div>
    </div>
  );
}
