import React from "react";

export function SessionOfferBar({ offer, onAccept, onDecline }) {
  if (!offer) return null;

  return (
    <div className="sessionOfferBar">
      <div className="sessionOfferText">
        Ihnen wurde eine Session angeboten:
        <br />
        <strong>{offer.session}</strong>
        {offer.seed ? (
          <>
            <br />
            Seed: <code>{offer.seed}</code>
          </>
        ) : null}
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
