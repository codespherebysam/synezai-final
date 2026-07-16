import { memo } from "react";
import Message from "./Message";

function MessageList({
  messages,
  loading,
  isSpeaking,
  userInitial,
  messagesEndRef,
  interactionVersion,
  actions,
}) {
  return (
    <section className={`messages ${messages.length <= 1 && !loading ? "welcome-mode" : "chat-mode"}`}>
      {messages.map((message, index) => (
        <Message
          key={message.id || `${message.role}-${index}`}
          message={message}
          index={index}
          userInitial={userInitial}
          isSpeaking={isSpeaking}
          loading={loading}
          interactionVersion={interactionVersion}
          onToast={actions.onToast}
          onEngineeringDecision={actions.onEngineeringDecision}
          onCopy={actions.onCopy}
          onLike={actions.onLike}
          onDislike={actions.onDislike}
          onShare={actions.onShare}
          onRegenerate={actions.onRegenerate}
          onMore={actions.onMore}
          onSpeak={actions.onSpeak}
          onStopSpeaking={actions.onStopSpeaking}
          onShowSources={actions.onShowSources}
        />
      ))}

      {loading && messages[messages.length - 1]?.role !== "assistant" && (
        <div className="message assistant">
          <div className="avatar">SY</div>
          <div className="bubble thinking-bubble">
            <span className="thinking-text">SYNEZ AI is thinking</span>
            <div className="thinking-dots">
              <span></span><span></span><span></span>
            </div>
          </div>
        </div>
      )}

      <div ref={messagesEndRef}></div>
    </section>
  );
}

export default memo(MessageList, (previous, next) =>
  previous.messages === next.messages &&
  previous.loading === next.loading &&
  previous.isSpeaking === next.isSpeaking &&
  previous.userInitial === next.userInitial &&
  previous.interactionVersion === next.interactionVersion
);
