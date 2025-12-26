import React from "react";

export function SessionOfferModal({ offer, onAccept, onDecline }) {
  if (!offer) return null;

  return (
    <div className="legalModal" onClick={onDecline}>
      <div
        className="legalModalCard"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="legalModalBody">
          <h3>Session wechseln?</h3>
          <p>
            {(offer.from || "Peer") + " bietet eine Session an:"}
            <br />
            <strong>{offer.session}</strong>
            {offer.seed ? (
              <>
                <br />
                Seed: <code>{offer.seed}</code>
              </>
            ) : null}
          </p>
          <div className="legalActions">
            <button type="button" className="legalClose" onClick={onDecline}>
              Ablehnen
            </button>
            <button
              type="button"
              className="legalClose"
              onClick={() => {
                onAccept?.();
              }}
            >
              Akzeptieren
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
