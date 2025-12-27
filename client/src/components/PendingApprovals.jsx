import React from "react";

export function PendingApprovals({ pending, onApprove, onReject }) {
  if (!pending || pending.length === 0) return null;
  return (
    <div className="pendingApprovals">
      <div className="pendingTitle">Neue Ger&auml;te warten auf Freigabe</div>
      <div className="pendingList">
        {pending.map((id) => (
          <div key={id} className="pendingItem">
            <span className="pendingId">{id.slice(0, 6)}</span>
            <div className="pendingActions">
              <button type="button" className="pendingBtn approve" onClick={() => onApprove?.(id)}>
                Approve
              </button>
              <button type="button" className="pendingBtn reject" onClick={() => onReject?.(id)}>
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
