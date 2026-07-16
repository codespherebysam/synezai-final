import { memo } from "react";
import ReactMarkdown from "react-markdown";
import { PrismAsyncLight as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";

function MarkdownContent({ content, onToast }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ inline, className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "");
          const language = match ? match[1] : "text";
          const codeText = String(children).replace(/\n$/, "");

          if (inline) {
            return <code className="inline-code" {...props}>{children}</code>;
          }

          return (
            <div className="chat-code-block">
              <div className="chat-code-header">
                <span>{language.toUpperCase()}</span>
                <button
                  className="code-copy-btn"
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(codeText);
                    onToast("Code copied");
                  }}
                >
                  Copy
                </button>
              </div>
              <SyntaxHighlighter
                language={language}
                style={oneDark}
                showLineNumbers
                wrapLongLines
                PreTag="div"
              >
                {codeText}
              </SyntaxHighlighter>
            </div>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function Message({
  message,
  index,
  userInitial,
  isSpeaking,
  loading,
  interactionVersion,
  onToast,
  onEngineeringDecision,
  onCopy,
  onLike,
  onDislike,
  onShare,
  onRegenerate,
  onMore,
  onSpeak,
  onStopSpeaking,
  onShowSources,
}) {
  if (message.role === "assistant" && !message.content?.trim()) return null;

  return (
    <div className={`message ${message.role}`}>
      <div className="avatar">{message.role === "user" ? userInitial : "SY"}</div>

      <div className="bubble">
        <div className="markdown-body">
          <MarkdownContent content={message.content} onToast={onToast} />

          {(message.imageDataUrl || message.imageUrl) && (
            <div className="generated-image-wrap">
              <img
                src={message.imageDataUrl || message.imageUrl}
                alt={message.imagePrompt ? `Generated: ${message.imagePrompt}` : "AI generated"}
                className="generated-image"
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                  const fallback = event.currentTarget.nextElementSibling;
                  if (fallback) fallback.style.display = "block";
                }}
              />
              <a
                className="generated-image-fallback"
                href={message.imageDataUrl || message.imageUrl}
                target="_blank"
                rel="noreferrer"
                style={{ display: "none" }}
              >
                Image preview failed. Open generated image ↗
              </a>
            </div>
          )}
        </div>

        {message.role === "assistant" && (
          <>
            {message.engineeringPlan?.status === "awaiting_approval" && message.engineeringPlan?.id && (
              <div className="engineering-plan-actions">
                <button
                  className="engineering-apply-btn"
                  onClick={() => onEngineeringDecision(index, message.engineeringPlan.id, "apply")}
                  disabled={loading}
                >
                  Apply Plan
                </button>
                <button
                  className="engineering-modify-btn"
                  onClick={() => onEngineeringDecision(index, message.engineeringPlan.id, "modify")}
                  disabled={loading}
                >
                  Modify Plan
                </button>
                <button
                  className="engineering-reject-btn"
                  onClick={() => onEngineeringDecision(index, message.engineeringPlan.id, "reject")}
                  disabled={loading}
                >
                  Reject
                </button>
              </div>
            )}

            <div className="message-actions">
              <button className="action-icon-btn" title="Copy" onClick={() => onCopy(message.content)}>⧉</button>
              <button className="action-icon-btn" title="Like" onClick={onLike}>♡</button>
              <button className="action-icon-btn" title="Dislike" onClick={onDislike}>♧</button>
              <button className="action-icon-btn" title="Share" onClick={() => onShare(message.content)}>⇧</button>
              <button className="action-icon-btn" title="Regenerate" onClick={onRegenerate}>↻</button>
              <button className="action-icon-btn" title="More" onClick={onMore}>⋯</button>
              <button
                className="action-icon-btn"
                title={isSpeaking ? "Stop Voice" : "Read Aloud"}
                onClick={() => (isSpeaking ? onStopSpeaking() : onSpeak(message.content))}
              >
                {isSpeaking ? "⏹" : "🔊"}
              </button>
              <button className="sources-btn" title="Sources" onClick={() => onShowSources(message.sources || [])}>
                ◧ Sources
              </button>
            </div>

            {message.provider && (
              <div className="model-badge">🤖 {message.provider} • {message.model}</div>
            )}

            {message.sources?.length > 0 && (
              <div className="source-cards-v2">
                {message.sources.slice(0, 6).map((source, sourceIndex) => (
                  <a
                    key={`${source.link || source.title}-${sourceIndex}`}
                    href={source.link}
                    target="_blank"
                    rel="noreferrer"
                    className="source-card-v2"
                  >
                    <div className="source-domain">🌐 {source.displayLink || "Source"}</div>
                    <strong>{source.title || "Untitled Source"}</strong>
                    {source.snippet && <p>{source.snippet}</p>}
                    <span>Open Source ↗</span>
                  </a>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default memo(Message, (previous, next) =>
  previous.message === next.message &&
  previous.index === next.index &&
  previous.userInitial === next.userInitial &&
  previous.isSpeaking === next.isSpeaking &&
  previous.loading === next.loading &&
  previous.interactionVersion === next.interactionVersion
);