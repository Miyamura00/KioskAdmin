// src/components/Toast.jsx
export function Toast({ toast }) {
  if (!toast) return null
  const colors = { success: '#27ae60', error: '#c0392b', warn: '#e67e22' }
  return (
    <div style={{
      position: 'fixed', bottom: 30, right: 30, zIndex: 9999,
      padding: '14px 22px', borderRadius: 8, fontWeight: 700,
      fontSize: '0.9rem', color: 'white',
      boxShadow: '0 4px 15px rgba(0,0,0,0.3)',
      background: colors[toast.type] || colors.success,
      animation: 'slideIn 0.3s ease',
    }}>
      {toast.msg}
    </div>
  )
}
