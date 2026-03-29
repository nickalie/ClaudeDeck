import { Focusable, Spinner } from "@decky/ui";
import { useEffect } from "react";
import { useChatStore } from "../stores/chatStore";

const STYLES = {
  wrapper: {
    padding: "12px 16px",
    height: "calc(100vh - 120px)",
    overflowY: "auto" as const,
  },
  item: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "#2a2a3e",
    borderRadius: "10px",
    padding: "12px 16px",
    marginBottom: "8px",
    cursor: "pointer",
    transition: "background 0.15s",
  },
  itemActive: {
    background: "#1a3a5c",
    border: "1px solid #1a9fff",
  },
  title: {
    fontSize: "14px",
    fontWeight: "bold" as const,
    color: "#e0e0e0",
    marginBottom: "4px",
  },
  meta: {
    fontSize: "12px",
    color: "#888",
  },
  deleteBtn: {
    background: "#c0392b",
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    padding: "6px 12px",
    fontSize: "12px",
    cursor: "pointer",
    marginLeft: "12px",
    flexShrink: 0,
  },
  empty: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "#888",
    gap: "10px",
  },
  newBtn: {
    background: "#1a9fff",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    padding: "10px 20px",
    fontSize: "14px",
    fontWeight: "bold" as const,
    cursor: "pointer",
    marginBottom: "16px",
    textAlign: "center" as const,
  },
};

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${day}.${month} ${hours}:${minutes}`;
}

export function HistoryView() {
  const conversations = useChatStore((s) => s.conversations);
  const loadingConversations = useChatStore((s) => s.loadingConversations);
  const loadConversations = useChatStore((s) => s.loadConversations);
  const loadConversation = useChatStore((s) => s.loadConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const createConversation = useChatStore((s) => s.createConversation);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const setTab = useChatStore((s) => s.setTab);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const handleOpen = (id: string) => {
    loadConversation(id);
    setTab("chat");
  };

  const handleNew = async () => {
    await createConversation();
    setTab("chat");
  };

  if (loadingConversations) {
    return (
      <div style={STYLES.empty}>
        <Spinner />
      </div>
    );
  }

  return (
    <div style={STYLES.wrapper}>
      <Focusable
        style={STYLES.newBtn}
        onActivate={handleNew}
        onOKActionDescription="Создать новый чат"
      >
        + Новый чат
      </Focusable>

      {conversations.length === 0 && (
        <div style={STYLES.empty}>
          <span style={{ fontSize: "16px" }}>Нет сохраненных диалогов</span>
          <span style={{ fontSize: "13px" }}>
            Начните новый чат, и он появится здесь
          </span>
        </div>
      )}

      {conversations.map((conv) => {
        const isActive = conv.id === activeConversationId;
        return (
          <Focusable
            key={conv.id}
            style={{ ...STYLES.item, ...(isActive ? STYLES.itemActive : {}) }}
            onActivate={() => handleOpen(conv.id)}
            onOKActionDescription="Открыть диалог"
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={STYLES.title}>{conv.title}</div>
              <div style={STYLES.meta}>
                {conv.message_count} сообщ. &middot; {formatDate(conv.updated_at)}
              </div>
            </div>
            <Focusable
              style={STYLES.deleteBtn}
              onActivate={() => deleteConversation(conv.id)}
              onOKActionDescription="Удалить диалог"
            >
              Удалить
            </Focusable>
          </Focusable>
        );
      })}
    </div>
  );
}
