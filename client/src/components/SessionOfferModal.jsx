import React from "react";

export function SessionOfferModal({ offer, onAccept, onDecline }) {
  if (!offer) return null;
  const senderId = offer.fromUuid ? offer.fromUuid.slice(0, 6) : null;
  const message = offer.isJoin ? "möchte Ihrer Session beitreten." : "möchte Sie zu einer Session einladen.";

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
            {senderId ? (
              <>
                <code className="offerSender">{senderId}</code> {message}
              </>
            ) : (
              "Neue Anfrage"
            )}
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
