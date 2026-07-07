import { Focusable, Spinner, TextField } from "@decky/ui";
import { marked } from "marked";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Message, useChatStore } from "../stores/chatStore";

marked.setOptions({ breaks: true, gfm: true });

const STYLES = {
  wrapper: {
    display: "flex",
    flexDirection: "column" as const,
    height: "calc(100vh - 150px)",
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
    wordBreak: "break-word" as const,
    fontSize: "14px",
    lineHeight: "1.45",
  },
  thinkingBubble: {
    background: "#1d1d2b",
    color: "#9a9ab3",
    padding: "8px 12px",
    borderRadius: "10px",
    maxWidth: "85%",
    fontSize: "13px",
    lineHeight: "1.4",
    fontStyle: "italic" as const,
    borderLeft: "3px solid #5a5a80",
  },
  toolUseBubble: {
    background: "#1a2a3e",
    color: "#8fd0ff",
    padding: "8px 12px",
    borderRadius: "10px",
    maxWidth: "85%",
    fontSize: "12px",
    fontFamily: "monospace" as const,
    borderLeft: "3px solid #1a9fff",
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-all" as const,
  },
  toolResultBubble: {
    background: "#16201a",
    color: "#9ad19a",
    padding: "8px 12px",
    borderRadius: "10px",
    maxWidth: "85%",
    fontSize: "12px",
    fontFamily: "monospace" as const,
    borderLeft: "3px solid #3c9a3c",
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-all" as const,
    maxHeight: "200px",
    overflowY: "auto" as const,
  },
  toolErrorBubble: {
    borderLeft: "3px solid #c0392b",
    color: "#ffb3a7",
    background: "#2a1616",
  },
  inputArea: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    padding: "10px 0 4px",
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
  stopBtn: {
    background: "#c0392b",
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

function formatToolUse(msg: Message): string {
  const name = msg.tool_name || "tool";
  const input = msg.tool_input;
  if (input === undefined || input === null) return `🔧 ${name}`;
  let body: string;
  try {
    body = typeof input === "string" ? input : JSON.stringify(input, null, 2);
  } catch {
    body = String(input);
  }
  if (body.length > 600) body = body.slice(0, 600) + "…";
  return `🔧 ${name}\n${body}`;
}

function truncate(text: string, max = 1500): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n… (ещё ${text.length - max} симв.)`;
}

function TextContent({ content }: { content: string }) {
  const html = useMemo(() => marked.parse(content) as string, [content]);
  return (
    <div>
      <div style={STYLES.roleLabel}>Claude</div>
      <div
        className="cd-md"
        style={STYLES.assistantBubble}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

function ThinkingContent({ content }: { content: string }) {
  return (
    <div>
      <div style={STYLES.roleLabel}>Размышление</div>
      <div style={STYLES.thinkingBubble}>{content}</div>
    </div>
  );
}

function ToolUseContent({ msg }: { msg: Message }) {
  return (
    <div>
      <div style={STYLES.roleLabel}>Инструмент: {msg.tool_name || ""}</div>
      <div style={STYLES.toolUseBubble}>{formatToolUse(msg)}</div>
    </div>
  );
}

function ToolResultContent({ msg }: { msg: Message }) {
  const label = msg.is_error ? "Ошибка инструмента" : "Результат";
  const style = {
    ...STYLES.toolResultBubble,
    ...(msg.is_error ? STYLES.toolErrorBubble : {}),
  };
  return (
    <div>
      <div style={STYLES.roleLabel}>{label}</div>
      <div style={style}>{truncate(msg.content)}</div>
    </div>
  );
}

function AssistantContent({ msg }: { msg: Message }) {
  const type = msg.item_type || "text";
  if (type === "thinking") return <ThinkingContent content={msg.content} />;
  if (type === "tool_use") return <ToolUseContent msg={msg} />;
  if (type === "tool_result") return <ToolResultContent msg={msg} />;
  return <TextContent content={msg.content} />;
}

function MessageBubble({
  msg, index, onTap,
}: {
  msg: Message; index: number; onTap?: (content: string) => void;
}) {
  const isUser = msg.role === "user";
  const handleClick = useCallback(
    () => onTap?.(msg.content),
    [msg.content, onTap],
  );
  return (
    <Focusable
      key={`${msg.timestamp}-${index}`}
      style={isUser ? STYLES.userRow : STYLES.assistantRow}
      onActivate={handleClick}
      onOKActionDescription="Копировать в поле ввода"
    >
      <div onClick={handleClick}>
        {isUser ? (
          <>
            <div style={STYLES.roleLabel}>Вы</div>
            <div style={STYLES.userBubble}>{msg.content}</div>
          </>
        ) : (
          <AssistantContent msg={msg} />
        )}
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

const CD_STYLES = `
  .cd-md p { margin: 0 0 8px; }
  .cd-md p:last-child { margin-bottom: 0; }
  .cd-md ul, .cd-md ol { margin: 4px 0; padding-left: 20px; }
  .cd-md code { background: #1a1a2e; padding: 1px 5px; border-radius: 4px; font-size: 13px; }
  .cd-md pre { background: #1a1a2e; padding: 8px 10px; border-radius: 6px; overflow-x: auto; margin: 6px 0; }
  .cd-md pre code { background: none; padding: 0; }
  .cd-md h1, .cd-md h2, .cd-md h3 { margin: 8px 0 4px; font-size: 15px; }
  .cd-md blockquote { border-left: 3px solid #555; margin: 6px 0; padding-left: 10px; color: #aaa; }
  .cd-md a { color: #1a9fff; }
  .cd-md img { max-width: 100%; border-radius: 6px; margin: 4px 0; cursor: pointer; display: block; }
  .cd-fullscreen { position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,0.92); display: flex; align-items: center; justify-content: center; cursor: pointer; }
  .cd-fullscreen img { max-width: 95vw; max-height: 95vh; object-fit: contain; border-radius: 8px; }
`;

function sendBtnStyle(sending: boolean, canSend: boolean) {
  if (sending) return { ...STYLES.sendBtn, ...STYLES.stopBtn };
  if (!canSend) return { ...STYLES.sendBtn, ...STYLES.sendBtnDisabled };
  return STYLES.sendBtn;
}

function InputBar({
  input, setInput, onSend, sending, onStop,
}: {
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  onStop: () => void;
}) {
  const canSend = !sending && !!input.trim();
  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };
  return (
    <Focusable style={STYLES.inputArea} onOKActionDescription="Отправить">
      <div style={{ flex: 1 }}>
        <TextField
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          bShowClearAction={false}
        />
      </div>
      <Focusable
        style={sendBtnStyle(sending, canSend)}
        onActivate={sending ? onStop : onSend}
        onOKActionDescription={sending ? "Остановить" : "Отправить сообщение"}
      >
        {sending ? "Стоп" : "Отправить"}
      </Focusable>
    </Focusable>
  );
}

function isVisibleMessage(msg: Message): boolean {
  if (msg.role === "user") return true;
  const t = msg.item_type || "text";
  return t === "text" || t === "thinking" || t === "tool_use" || t === "tool_result";
}

function MessagesArea({
  messages, sending, activeConversationId, onImgClick, onBubbleTap, scrollRef,
}: {
  messages: Message[];
  sending: boolean;
  activeConversationId: string | null;
  onImgClick: (e: React.MouseEvent) => void;
  onBubbleTap: (content: string) => void;
  scrollRef: React.RefObject<HTMLDivElement>;
}) {
  const visible = useMemo(() => messages.filter(isVisibleMessage), [messages]);
  const lastIsAssistant = visible[visible.length - 1]?.role === "assistant";
  const showTyping = sending && !lastIsAssistant;
  return (
    <div ref={scrollRef} style={STYLES.messagesArea} onClick={onImgClick}>
      {visible.length === 0 && (
        <EmptyState hasActiveConversation={!!activeConversationId} />
      )}
      {visible.map((msg, i) => (
        <MessageBubble
          key={`${msg.timestamp}-${i}`}
          msg={msg}
          index={i}
          onTap={onBubbleTap}
        />
      ))}
      {showTyping && <TypingIndicator />}
    </div>
  );
}

export function ChatView() {
  const messages = useChatStore((s) => s.messages);
  const sending = useChatStore((s) => s.sending);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const stopGeneration = useChatStore((s) => s.stopGeneration);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const loadingMessages = useChatStore((s) => s.loadingMessages);

  const [input, setInput] = useState("");
  const [fullscreenImg, setFullscreenImg] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  const handleImgClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "IMG") {
      setFullscreenImg((target as HTMLImageElement).src);
    }
  }, []);

  const handleBubbleTap = useCallback((content: string) => {
    if (!input.trim()) setInput(content);
  }, [input]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    sendMessage(text);
  }, [input, sending, sendMessage]);

  if (loadingMessages) {
    return (
      <div style={STYLES.emptyState}>
        <Spinner />
      </div>
    );
  }

  return (
    <div style={STYLES.wrapper}>
      <style>{CD_STYLES}</style>
      {fullscreenImg && (
        <div className="cd-fullscreen" onClick={() => setFullscreenImg(null)}>
          <img src={fullscreenImg} alt="" />
        </div>
      )}
      <MessagesArea
        messages={messages}
        sending={sending}
        activeConversationId={activeConversationId}
        onImgClick={handleImgClick}
        onBubbleTap={handleBubbleTap}
        scrollRef={scrollRef}
      />
      <InputBar
        input={input}
        setInput={setInput}
        onSend={handleSend}
        sending={sending}
        onStop={stopGeneration}
      />
    </div>
  );
}
