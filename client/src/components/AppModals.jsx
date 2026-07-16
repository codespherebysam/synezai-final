export function MemoryModal({ isLoading, memory, onClose, onRefresh, onForget, onClear }) {
  return (
    <div className="memory-overlay">
      <div className="memory-modal">
        <div className="memory-header">
          <div>
            <h3>🧠 Saved Memory</h3>
            <p>Memory is saved separately for the logged-in account.</p>
          </div>
          <button className="memory-close-btn" onClick={onClose} aria-label="Close memory">✕</button>
        </div>

        {isLoading ? (
          <div className="memory-empty">Loading memory...</div>
        ) : Object.keys(memory).length === 0 ? (
          <div className="memory-empty">
            No saved memory yet.<br />
            Try: <strong>remember project is SYNEZ AI</strong>
          </div>
        ) : (
          <div className="memory-list">
            {Object.entries(memory).map(([key, value]) => (
              <div className="memory-item" key={key}>
                <div><span>{key}</span><strong>{String(value)}</strong></div>
                <button onClick={() => onForget(key)}>Forget</button>
              </div>
            ))}
          </div>
        )}

        <div className="memory-actions">
          <button onClick={onRefresh}>Refresh</button>
          <button className="memory-danger-btn" onClick={onClear}>Clear All</button>
        </div>
      </div>
    </div>
  );
}

export function DashboardModal({
  totalChats,
  totalMessages,
  memoryCount,
  selectedModel,
  user,
  theme,
  onClose,
}) {
  return (
    <div className="dashboard-overlay">
      <div className="dashboard-modal">
        <div className="dashboard-header">
          <div><h3>📊 Usage Dashboard</h3><p>SYNEZ AI activity overview</p></div>
          <button className="dashboard-close-btn" onClick={onClose} aria-label="Close dashboard">✕</button>
        </div>

        <div className="dashboard-grid">
          <div className="dashboard-card"><span>Total Chats</span><strong>{totalChats}</strong></div>
          <div className="dashboard-card"><span>Total Messages</span><strong>{totalMessages}</strong></div>
          <div className="dashboard-card"><span>Saved Memories</span><strong>{memoryCount}</strong></div>
          <div className="dashboard-card"><span>Current Model</span><strong>{selectedModel}</strong></div>
          <div className="dashboard-card"><span>User</span><strong>{user}</strong></div>
          <div className="dashboard-card"><span>Theme</span><strong>{theme}</strong></div>
        </div>

        <div className="dashboard-status">
          <div>Web Search Ready</div>
          <div>Agent Mode Pro+ Ready</div>
          <div>Voice Ready</div>
          <div>Drag & Drop Ready</div>
          <div>Memory Ready</div>
        </div>
      </div>
    </div>
  );
}

export function ConfirmDialog({ type, onCancel, onConfirm }) {
  return (
    <div className="confirm-overlay">
      <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <h3 id="confirm-title">{type === "all" ? "Delete all chats?" : "Delete chat?"}</h3>
        <p>
          {type === "all"
            ? "This will permanently delete every saved chat."
            : "This chat will be permanently deleted."}
        </p>
        <div className="confirm-actions">
          <button className="cancel-btn" onClick={onCancel}>Cancel</button>
          <button className="confirm-delete-btn" onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
}

export function Toast({ message }) {
  return <div className="toast" role="status">{message}</div>;
}
