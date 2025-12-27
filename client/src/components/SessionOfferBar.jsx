import React from "react";

export function SessionOfferBar({ offer, onAccept, onDecline }) {
  if (!offer) return null;
  const senderId = offer.fromUuid ? offer.fromUuid.slice(0, 6) : null;
  const message = offer.isJoin ? "möchte Ihrer Session beitreten" : "möchte Sie zu einer Session einladen";

  return (
    <div className="sessionOfferBar">
      <div className="sessionOfferText">
        {senderId ? (
          <>
            <code className="offerSender">{senderId}</code> {message}
          </>
        ) : (
          "Neue Anfrage"
        )}
      </div>
      <div className="sessionOfferActions">
        <button type="button" className="sessionOfferBtn ghost" onClick={onDecline}>
          Ablehnen
        </button>
        <button type="button" className="sessionOfferBtn" onClick={onAccept}>
          Beitreten
        </button>
      </div>
    </div>
  );
}
