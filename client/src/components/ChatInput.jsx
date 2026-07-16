function ChatInput({
  inputRef,
  value,
  loading,
  isSpeaking,
  selectedFiles,
  selectedImages,
  imagePreviews,
  onChange,
  onKeyDown,
  onFileSelect,
  onRemoveFile,
  onRemoveImage,
  onClearUploads,
  onStopSpeaking,
  onToggleVoice,
  onSubmit,
  onStopGenerating,
}) {
  const attachmentCount = selectedFiles.length + selectedImages.length;

  return (
    <div className="input-area">
      <div className={`chat-input-box ${attachmentCount ? "has-upload" : ""}`}>
        {attachmentCount > 0 && (
          <div className="composer-attachments-list">
            {selectedFiles.map((file, index) => (
              <div className="composer-attachment-card" key={`${file.name}-${file.size}-${index}`}>
                <span className="composer-attachment-icon">📄</span>
                <span className="composer-attachment-name">{file.name}</span>
                <button
                  type="button"
                  className="composer-attachment-remove"
                  onClick={() => onRemoveFile(index)}
                  aria-label={`Remove ${file.name}`}
                >
                  ×
                </button>
              </div>
            ))}

            {selectedImages.map((file, index) => {
              const preview = imagePreviews[index]?.url;
              return (
                <div
                  className="composer-attachment-card image-attachment-card"
                  key={`${file.name}-${file.size}-${index}`}
                >
                  {preview ? (
                    <img
                      src={preview}
                      alt=""
                      className="composer-attachment-thumb"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <span className="composer-attachment-icon">🖼️</span>
                  )}
                  <span className="composer-attachment-name">{file.name}</span>
                  <button
                    type="button"
                    className="composer-attachment-remove"
                    onClick={() => onRemoveImage(index)}
                    aria-label={`Remove ${file.name}`}
                  >
                    ×
                  </button>
                </div>
              );
            })}

            {attachmentCount > 1 && (
              <button type="button" className="composer-clear-all" onClick={onClearUploads}>
                Clear all · {attachmentCount}
              </button>
            )}
          </div>
        )}

        <label className="upload-btn" title="Add files">
          +
          <input
            type="file"
            hidden
            multiple
            accept=".pdf,.doc,.docx,.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.html,.css,.py,.java,.cpp,.c,.xml,.yml,.yaml,image/*"
            onChange={(event) => {
              onFileSelect(event.target.files);
              event.target.value = "";
            }}
          />
        </label>

        <textarea
          ref={inputRef}
          rows={1}
          placeholder="Message SYNEZ AI..."
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
        />

        {isSpeaking && (
          <button className="stop-speech-btn" onClick={onStopSpeaking}>⏹ Stop Voice</button>
        )}

        <button className="voice-btn" onClick={onToggleVoice} type="button" aria-label="Voice input">
          🎙
        </button>

        <button
          type="button"
          onClick={loading ? onStopGenerating : onSubmit}
          className={`send-circle-btn ${loading ? "stop-btn" : ""}`}
          aria-label={loading ? "Stop generating" : "Send message"}
        >
          {loading ? (
            "■"
          ) : (
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M12 19V5M12 5L6 11M12 5L18 11"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

export default ChatInput;