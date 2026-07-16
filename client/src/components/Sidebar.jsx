import { memo } from "react";

function ChatHistoryRow({
  chat,
  isOpen,
  isPinned,
  renameChatId,
  renameText,
  onLoad,
  onToggleMenu,
  onStartRename,
  onRenameTextChange,
  onRename,
  onPin,
  onDelete,
}) {
  return (
    <div className="history-row-wrapper">
      <div className="history-row">
        <button className="history-item" onClick={() => onLoad(chat)}>
          {chat.title}
        </button>
        <button
          className="chat-menu-btn"
          aria-label={`Open actions for ${chat.title}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleMenu(chat.id);
          }}
        >
          <span className="dot"></span>
          <span className="dot"></span>
          <span className="dot"></span>
        </button>
      </div>

      {isOpen && (
        <div className="chat-menu">
          <button onClick={() => onStartRename(chat)}>✏️ Rename</button>
          <button onClick={() => onPin(chat)}>
            {isPinned ? "📌 Unpin Chat" : "📌 Pin Chat"}
          </button>
          <button className="danger-menu" onClick={() => onDelete(chat.id)}>
            🗑 Delete
          </button>
        </div>
      )}

      {renameChatId === chat.id && (
        <div className="rename-box">
          <input
            value={renameText}
            onChange={(event) => onRenameTextChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onRename(chat.id);
            }}
          />
          <button onClick={() => onRename(chat.id)}>Save</button>
        </div>
      )}
    </div>
  );
}

function Sidebar({
  isOpen,
  theme,
  searchQuery,
  pinnedChats,
  chats,
  openMenuId,
  renameChatId,
  renameText,
  userEmail,
  currentModelLabel,
  isPinned,
  onClose,
  onNewChat,
  onToggleTheme,
  onSearchChange,
  onOpenMemory,
  onDeleteAll,
  onLoadChat,
  onToggleMenu,
  onStartRename,
  onRenameTextChange,
  onRename,
  onPin,
  onDelete,
}) {
  const renderChat = (chat) => (
    <ChatHistoryRow
      key={chat.id}
      chat={chat}
      isOpen={openMenuId === chat.id}
      isPinned={isPinned(chat.id)}
      renameChatId={renameChatId}
      renameText={renameText}
      onLoad={onLoadChat}
      onToggleMenu={onToggleMenu}
      onStartRename={onStartRename}
      onRenameTextChange={onRenameTextChange}
      onRename={onRename}
      onPin={onPin}
      onDelete={onDelete}
    />
  );

  return (
    <aside className={`sidebar ${isOpen ? "show-sidebar" : ""}`}>
      <button className="close-sidebar" onClick={onClose} aria-label="Close sidebar">
        ✕
      </button>
      <h2>SYNEZ AI</h2>
      <button className="side-btn" onClick={onNewChat}>+ New Chat</button>
      <button className="side-btn" onClick={onToggleTheme}>
        {theme === "dark" ? "☀ Light Mode" : "🌙 Dark Mode"}
      </button>
      <input
        className="chat-search"
        placeholder="Search chats..."
        value={searchQuery}
        onChange={(event) => onSearchChange(event.target.value)}
      />
      <button className="side-btn memory-side-btn" onClick={onOpenMemory}>🧠 Saved Memory</button>
      <button className="side-btn delete-all-btn" onClick={onDeleteAll}>Delete All Chats</button>

      <div className="history-list">
        {pinnedChats.length > 0 && <p className="history-label">Pinned</p>}
        {pinnedChats.map(renderChat)}
        {chats.length > 0 && <p className="history-label">Recent</p>}
        {chats.map(renderChat)}
      </div>

      <div className="sidebar-info">
        <p>{userEmail || "Logged in"}</p>
        <p>Multi AI Connected</p>
        <p>{currentModelLabel}</p>
      </div>
    </aside>
  );
}

export default memo(Sidebar, (previous, next) =>
  previous.isOpen === next.isOpen &&
  previous.theme === next.theme &&
  previous.searchQuery === next.searchQuery &&
  previous.pinnedChats === next.pinnedChats &&
  previous.chats === next.chats &&
  previous.openMenuId === next.openMenuId &&
  previous.renameChatId === next.renameChatId &&
  previous.renameText === next.renameText &&
  previous.userEmail === next.userEmail &&
  previous.currentModelLabel === next.currentModelLabel
);