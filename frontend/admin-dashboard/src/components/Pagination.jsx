/**
 * Shared pagination component. Used by ProjectList, StudentList, and
 * ResourceRequestList. Renders numbered page buttons with ellipses,
 * "Showing X–Y of Z" range info, and prev/next buttons.
 */
export default function Pagination({ page, totalPages, onPrev, onNext, onJump, totalItems, limit }) {
    const safeTotal = Math.max(totalPages, 1);
    const from = totalItems === 0 ? 0 : (page - 1) * limit + 1;
    const to = Math.min(page * limit, totalItems);

    const pages = [];
    if (safeTotal <= 7) {
        for (let i = 1; i <= safeTotal; i++) pages.push(i);
    } else {
        pages.push(1);
        if (page > 3) pages.push('…');
        for (let i = Math.max(2, page - 1); i <= Math.min(safeTotal - 1, page + 1); i++) {
            pages.push(i);
        }
        if (page < safeTotal - 2) pages.push('…');
        pages.push(safeTotal);
    }

    if (totalItems === 0) return null;

    return (
        <div className="pg-pagination">
            <div className="pg-range">
                Showing <strong>{from}</strong>–<strong>{to}</strong> of <strong>{totalItems}</strong>
            </div>
            <div className="pg-pager">
                <button disabled={page <= 1} onClick={onPrev} className="pg-btn">← Prev</button>
                {pages.map((p, i) =>
                    p === '…' ? (
                        <span key={`e-${i}`} className="pg-ellipsis">…</span>
                    ) : (
                        <button
                            key={p}
                            className={`pg-btn${p === page ? ' active' : ''}`}
                            onClick={() => onJump(p)}
                        >
                            {p}
                        </button>
                    )
                )}
                <button disabled={page >= safeTotal} onClick={onNext} className="pg-btn">Next →</button>
            </div>
            <style>{`
        .pg-pagination {
          display: flex; align-items: center; justify-content: space-between;
          gap: 1rem; margin: 1rem 0; flex-wrap: wrap;
        }
        .pg-range { font-size: 0.8rem; color: var(--text-secondary); }
        .pg-range strong { color: var(--text-primary); font-weight: 600; }
        .pg-pager { display: inline-flex; align-items: center; gap: 0.25rem; }
        .pg-btn {
          background: var(--card-bg); border: 1px solid var(--border);
          color: var(--text-primary); padding: 0.35rem 0.75rem;
          min-width: 34px; border-radius: 6px; font-size: 0.8rem;
          font-family: inherit; cursor: pointer;
          transition: background 0.1s, border-color 0.1s;
        }
        .pg-btn:hover:not(:disabled):not(.active) {
          background: var(--bg-tertiary); border-color: var(--border-strong);
        }
        .pg-btn.active {
          background: var(--accent); border-color: var(--accent);
          color: #fff; font-weight: 600;
        }
        .pg-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .pg-ellipsis { padding: 0 0.35rem; color: var(--text-muted); font-size: 0.85rem; }
      `}</style>
        </div>
    );
}