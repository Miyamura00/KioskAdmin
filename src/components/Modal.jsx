// src/components/Modal.jsx
import { createPortal } from 'react-dom'

export function Modal({ show, onClose, title, children, actions, wide }) {
  if (!show) return null

  return createPortal(
    <div
      className="modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal-box" style={wide ? { maxWidth: 680 } : {}}>
        <div className="modal-header">
          <h3>{title}</h3>
          <span className="close-btn" onClick={onClose}>
            &times;
          </span>
        </div>
        <div className="modal-body">{children}</div>
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>,
    document.body   // ← renders outside page-content scroll container
  )
}
