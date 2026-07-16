import { memo } from "react";

function Topbar({
  theme,
  modelOpen,
  modelOptions,
  selectedModel,
  currentModel,
  showWorkPanel,
  showProfileMenu,
  userInitial,
  displayName,
  userEmail,
  interactionVersion,
  onToggleSidebar,
  onOpenDashboard,
  onToggleTheme,
  onToggleModelMenu,
  onSelectModel,
  onToggleWorkPanel,
  onToggleProfileMenu,
  onExportPdf,
  onExportTxt,
  onExportJson,
  onLogout,
}) {
  return (
    <header className="topbar">
      <div>
        <h1>SYNEZ AI</h1>
        <p>Synergized Neural Intelligence</p>
      </div>

      <div className="top-actions">
        <button className="hamburger-btn" aria-label="Toggle sidebar" onClick={onToggleSidebar}>☰</button>
        <button className="dashboard-top-btn" onClick={onOpenDashboard}>📊 Usage Dashboard</button>
        <button className="mobile-theme-btn" onClick={onToggleTheme} aria-label="Toggle theme">
          {theme === "dark" ? "☀️" : "🌙"}
        </button>

        <div className="model-dropdown">
          <button type="button" className="model-trigger" onClick={onToggleModelMenu}>
            <span>{currentModel.icon}</span>
            <span className="model-trigger-text">{currentModel.label}</span>
            <span className={modelOpen ? "model-trigger-arrow open" : "model-trigger-arrow"}>▾</span>
          </button>
          {modelOpen && (
            <div className="model-menu">
              {modelOptions.map((model) => (
                <button
                  type="button"
                  key={model.value}
                  className={selectedModel === model.value ? "model-option active" : "model-option"}
                  onClick={() => onSelectModel(model.value)}
                >
                  <span>{model.icon}</span><span>{model.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button type="button" className="panel-toggle-btn" onClick={onToggleWorkPanel} title="Code Preview">
          {showWorkPanel ? "Hide Panel" : "Code / Preview"}
        </button>

        <div className="profile-wrapper">
          <button className="profile-btn" aria-label="Profile menu" onClick={onToggleProfileMenu}>
            {userInitial}
          </button>
          {showProfileMenu && (
            <div className="profile-menu">
              <strong>{displayName}</strong>
              <p>{userEmail}</p>
              <button onClick={onExportPdf}>📄 Export PDF</button>
              <button onClick={onExportTxt}>📝 Export TXT</button>
              <button onClick={onExportJson}>📦 Export JSON</button>
              <button onClick={onToggleTheme}>🎨 Toggle Theme</button>
              <button className="danger-menu" onClick={onLogout}>🚪 Logout</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export default memo(Topbar, (previous, next) =>
  previous.theme === next.theme &&
  previous.modelOpen === next.modelOpen &&
  previous.modelOptions === next.modelOptions &&
  previous.selectedModel === next.selectedModel &&
  previous.currentModel === next.currentModel &&
  previous.showWorkPanel === next.showWorkPanel &&
  previous.showProfileMenu === next.showProfileMenu &&
  previous.userInitial === next.userInitial &&
  previous.displayName === next.displayName &&
  previous.userEmail === next.userEmail &&
  previous.interactionVersion === next.interactionVersion
);
