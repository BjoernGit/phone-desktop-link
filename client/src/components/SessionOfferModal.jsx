import React from "react";
import { useTranslation } from "react-i18next";

export function SessionOfferModal({ offer, onAccept, onDecline }) {
  const { t } = useTranslation();
  if (!offer) return null;
  const senderId = offer.fromUuid ? offer.fromUuid.slice(0, 6) : null;
  const message = offer.isJoin ? t("offer.wantsToJoinModal", { device: "" }) : t("offer.invitesYouModal", { device: "" });

  return (
    <div className="legalModal" onClick={onDecline}>
      <div
        className="legalModalCard"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="legalModalBody">
          <h3>{t("offer.modalTitle")}</h3>
          <p>
            {senderId ? (
              <>
                <code className="offerSender">{senderId}</code> {message}
              </>
            ) : (
              t("offer.newRequest")
            )}
          </p>
          <div className="legalActions">
            <button type="button" className="legalClose" onClick={onDecline}>
              {t("common.buttons.decline")}
            </button>
            <button
              type="button"
              className="legalClose"
              onClick={() => {
                onAccept?.();
              }}
            >
              {t("common.buttons.accept")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
