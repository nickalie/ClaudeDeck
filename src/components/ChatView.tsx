import { Focusable, Spinner, TextField } from "@decky/ui";
import { useEffect, useRef, useState } from "react";
import { Message, useChatStore } from "../stores/chatStore";

const STYLES = {
  wrapper: {
    display: "flex",
    flexDirection: "column" as const,
    height: "calc(100vh - 100px)",
    padding: "0 16px",
  },
  messagesArea: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "12px 0",
    scrollBehavior: "smooth" as const,
  },
  userRow: {
    display: "flex",
    justifyContent: "flex-end",
    marginBottom: "10px",
  },
  assistantRow: {
    display: "flex",
    justifyContent: "flex-start",
    marginBottom: "10px",
  },
  userBubble: {
    background: "#1a9fff",
    color: "#fff",
    padding: "10px 14px",
    borderRadius: "14px 14px 4px 14px",
    maxWidth: "80%",
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
    fontSize: "14px",
    lineHeight: "1.45",
  },
  assistantBubble: {
    background: "#2a2a3e",
    color: "#e0e0e0",
    padding: "10px 14px",
    borderRadius: "14px 14px 14px 4px",
    maxWidth: "85%",
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
    fontSize: "14px",
    lineHeight: "1.45",
  },
  inputArea: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    padding: "10px 0",
    borderTop: "1px solid #333",
  },
  sendBtn: {
    background: "#1a9fff",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    padding: "8px 18px",
    fontSize: "14px",
    fontWeight: "bold" as const,
    cursor: "pointer",
    minWidth: "100px",
    opacity: 1,
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
  emptyState: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    color: "#888",
    gap: "12px",
  },
  roleLabel: {
    fontSize: "11px",
    fontWeight: "bold" as const,
    marginBottom: "4px",
    opacity: 0.6,
  },
};

function EmptyState({ hasActiveConversation }: { hasActiveConversation: boolean }) {
  if (hasActiveConversation) {
    return (
      <div style={STYLES.emptyState}>
        <span style={{ fontSize: "16px" }}>Пустой диалог</span>
        <span style={{ fontSize: "13px", color: "#666" }}>Напишите первое сообщение</span>
      </div>
    );
  }
  return (
    <div style={STYLES.emptyState}>
      <span style={{ fontSize: "32px" }}>{">"}_</span>
      <span style={{ fontSize: "16px" }}>Начните диалог с Claude</span>
      <span style={{ fontSize: "13px", color: "#666" }}>Введите сообщение и нажмите Отправить</span>
    </div>
  );
}

function MessageBubble({ msg, index }: { msg: Message; index: number }) {
  const isUser = msg.role === "user";
  return (
    <Focusable
      key={`${msg.timestamp}-${index}`}
      style={isUser ? STYLES.userRow : STYLES.assistantRow}
    >
      <div>
        <div style={STYLES.roleLabel}>{isUser ? "Вы" : "Claude"}</div>
        <div style={isUser ? STYLES.userBubble : STYLES.assistantBubble}>
          {msg.content}
        </div>
      </div>
    </Focusable>
  );
}

function TypingIndicator() {
  return (
    <div style={{ ...STYLES.assistantRow, padding: "10px 14px" }}>
      <div>
        <div style={STYLES.roleLabel}>Claude</div>
        <div style={STYLES.assistantBubble}>
          <Spinner style={{ width: "20px", height: "20px" }} />
        </div>
      </div>
    </div>
  );
}

export function ChatView() {
  const messages = useChatStore((s) => s.messages);
  const sending = useChatStore((s) => s.sending);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const loadingMessages = useChatStore((s) => s.loadingMessages);

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    sendMessage(text);
  };

  if (loadingMessages) {
    return (
      <div style={STYLES.emptyState}>
        <Spinner />
      </div>
    );
  }

  const disabled = sending || !input.trim();

  return (
    <div style={STYLES.wrapper}>
      <div ref={scrollRef} style={STYLES.messagesArea}>
        {messages.length === 0 && <EmptyState hasActiveConversation={!!activeConversationId} />}
        {messages.map((msg, i) => (
          <MessageBubble key={`${msg.timestamp}-${i}`} msg={msg} index={i} />
        ))}
        {sending && <TypingIndicator />}
      </div>

      <Focusable style={STYLES.inputArea} onOKActionDescription="Отправить">
        <div style={{ flex: 1 }}>
          <TextField
            value={input}
            onChange={(e) => setInput(e.target.value)}
            bShowClearAction={true}
          />
        </div>
        <Focusable
          style={{ ...STYLES.sendBtn, ...(disabled ? STYLES.sendBtnDisabled : {}) }}
          onActivate={handleSend}
          onOKActionDescription="Отправить сообщение"
        >
          {sending ? "..." : "Отправить"}
        </Focusable>
      </Focusable>
    </div>
  );
}
