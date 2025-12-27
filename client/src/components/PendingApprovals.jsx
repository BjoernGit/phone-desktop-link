import React from "react";

export function PendingApprovals({ pending, onApprove, onReject }) {
  if (!pending || pending.length === 0) return null;
  return (
    <div className="pendingApprovals">
      {pending.map((id) => {
        const shortId = id.slice(0, 6);
        return (
          <div key={id} className="sessionOfferBar pendingBar">
            <div className="sessionOfferText">
              <code className="offerSender">{shortId}</code> m&ouml;chte Ihrer Session beitreten
            </div>
            <div className="sessionOfferActions">
              <button type="button" className="sessionOfferBtn ghost" onClick={() => onReject?.(id)}>
                Ablehnen
              </button>
              <button type="button" className="sessionOfferBtn" onClick={() => onApprove?.(id)}>
                Zulassen
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
