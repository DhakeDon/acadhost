/**
 * ToastContext — lightweight toast notification system.
 * Usage: const { toast } = useToast();
 *        toast.success('Saved!'); toast.error('Failed'); toast.warning('...')
 *
 * Replaces window.alert() everywhere in the admin dashboard.
 */
import { createContext, useCallback, useContext, useState } from 'react';

const ToastContext = createContext(null);

let nextId = 1;

export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);

    const dismiss = useCallback((id) => {
        setToasts((list) => list.filter((t) => t.id !== id));
    }, []);

    const show = useCallback((message, tone = 'info', opts = {}) => {
        const id = nextId++;
        const duration = opts.duration ?? (tone === 'error' ? 6000 : 4000);
        setToasts((list) => [...list, { id, message, tone }]);
        if (duration > 0) {
            setTimeout(() => dismiss(id), duration);
        }
        return id;
    }, [dismiss]);

    // Convenience API
    const toast = {
        success: (msg, opts) => show(msg, 'success', opts),
        error:   (msg, opts) => show(msg, 'error', opts),
        warning: (msg, opts) => show(msg, 'warning', opts),
        info:    (msg, opts) => show(msg, 'info', opts),
        dismiss,
    };

    return (
        <ToastContext.Provider value={{ toast }}>
            {children}
            <div className="toast-stack" role="status" aria-live="polite">
                {toasts.map((t) => (
                    <div key={t.id} className={`toast toast-${t.tone}`}>
            <span className="toast-icon">
              {t.tone === 'success' && '✓'}
                {t.tone === 'error' && '⚠'}
                {t.tone === 'warning' && '⚠'}
                {t.tone === 'info' && 'ℹ'}
            </span>
                        <span className="toast-message">{t.message}</span>
                        <button
                            className="toast-close"
                            onClick={() => dismiss(t.id)}
                            aria-label="Dismiss"
                        >
                            ✕
                        </button>
                    </div>
                ))}
            </div>
            <style>{`
        .toast-stack {
          position: fixed;
          top: 1rem;
          right: 1rem;
          z-index: 9999;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          max-width: calc(100vw - 2rem);
          width: 380px;
          pointer-events: none;
        }
        .toast {
          display: flex;
          align-items: flex-start;
          gap: 0.65rem;
          padding: 0.75rem 0.9rem;
          border-radius: 8px;
          background: var(--card-bg);
          border: 1px solid var(--border);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
          font-family: 'Inter', 'DM Sans', 'Segoe UI', sans-serif;
          font-size: 0.85rem;
          color: var(--text-primary);
          pointer-events: auto;
          animation: toast-in 0.2s ease-out;
        }
        @keyframes toast-in {
          from { transform: translateX(calc(100% + 1rem)); opacity: 0; }
          to   { transform: translateX(0); opacity: 1; }
        }
        .toast-success { border-left: 3px solid var(--success); }
        .toast-error   { border-left: 3px solid var(--error); }
        .toast-warning { border-left: 3px solid var(--warning); }
        .toast-info    { border-left: 3px solid var(--info); }

        .toast-icon {
          flex-shrink: 0;
          font-weight: 700;
          width: 18px;
          text-align: center;
        }
        .toast-success .toast-icon { color: var(--success); }
        .toast-error   .toast-icon { color: var(--error); }
        .toast-warning .toast-icon { color: var(--warning); }
        .toast-info    .toast-icon { color: var(--info); }

        .toast-message {
          flex: 1;
          line-height: 1.45;
          word-wrap: break-word;
        }
        .toast-close {
          background: transparent;
          border: none;
          color: var(--text-muted);
          font-size: 0.85rem;
          cursor: pointer;
          padding: 0 2px;
          line-height: 1;
          flex-shrink: 0;
        }
        .toast-close:hover { color: var(--text-primary); }

        @media (max-width: 640px) {
          .toast-stack {
            top: 0.5rem;
            right: 0.5rem;
            left: 0.5rem;
            width: auto;
          }
        }
      `}</style>
        </ToastContext.Provider>
    );
}

export function useToast() {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
    return ctx;
}