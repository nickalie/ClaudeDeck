import { create } from "zustand";
import { callable, toaster } from "@decky/api";

export interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface Conversation {
  id: string;
  title: string;
  session_id: string | null;
  messages: Message[];
  created_at: number;
  updated_at: number;
}

export interface ConversationSummary {
  id: string;
  title: string;
  message_count: number;
  updated_at: number;
}

interface ChatState {
  activeTab: string;
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  messages: Message[];
  sending: boolean;
  loadingConversations: boolean;
  loadingMessages: boolean;

  setTab: (tab: string) => void;
  loadConversations: () => Promise<void>;
  loadConversation: (id: string) => Promise<void>;
  createConversation: () => Promise<string | null>;
  deleteConversation: (id: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  clearActive: () => void;
}

const rpcCreateConversation = callable<[], { status: string; conversation: Conversation }>(
  "create_conversation",
);
const rpcGetConversations = callable<[], ConversationSummary[]>("get_conversations");
const rpcLoadConversation = callable<[string], { status: string; conversation: Conversation }>(
  "load_conversation",
);
const rpcDeleteConversation = callable<[string], { status: string }>("delete_conversation");
const rpcSendMessage = callable<
  [string, string],
  { status: string; response?: string; message?: string }
>("send_message");

export const useChatStore = create<ChatState>((set, get) => ({
  activeTab: "chat",
  conversations: [],
  activeConversationId: null,
  messages: [],
  sending: false,
  loadingConversations: false,
  loadingMessages: false,

  setTab: (tab: string) => set({ activeTab: tab }),

  loadConversations: async () => {
    set({ loadingConversations: true });
    try {
      const list = await rpcGetConversations();
      set({ conversations: list });
    } catch (e) {
      console.error("Failed to load conversations", e);
    } finally {
      set({ loadingConversations: false });
    }
  },

  loadConversation: async (id: string) => {
    set({ loadingMessages: true, activeConversationId: id });
    try {
      const res = await rpcLoadConversation(id);
      if (res.status === "ok") {
        set({ messages: res.conversation.messages });
      } else {
        toaster.toast({ title: "ClaudeDeck", body: "Не удалось загрузить диалог" });
      }
    } catch (e) {
      console.error("Failed to load conversation", e);
    } finally {
      set({ loadingMessages: false });
    }
  },

  createConversation: async () => {
    try {
      const res = await rpcCreateConversation();
      if (res.status === "ok") {
        const conv = res.conversation;
        set({
          activeConversationId: conv.id,
          messages: [],
        });
        await get().loadConversations();
        return conv.id;
      }
    } catch (e) {
      console.error("Failed to create conversation", e);
    }
    return null;
  },

  deleteConversation: async (id: string) => {
    try {
      await rpcDeleteConversation(id);
      const state = get();
      if (state.activeConversationId === id) {
        set({ activeConversationId: null, messages: [] });
      }
      await state.loadConversations();
    } catch (e) {
      console.error("Failed to delete conversation", e);
    }
  },

  sendMessage: async (text: string) => {
    const state = get();
    let convId = state.activeConversationId;

    // Auto-create conversation if none active
    if (!convId) {
      convId = await state.createConversation();
      if (!convId) {
        toaster.toast({ title: "ClaudeDeck", body: "Не удалось создать диалог" });
        return;
      }
    }

    // Optimistically add user message
    const userMsg: Message = {
      role: "user",
      content: text,
      timestamp: Math.floor(Date.now() / 1000),
    };
    set((s) => ({ messages: [...s.messages, userMsg], sending: true }));

    try {
      const res = await rpcSendMessage(convId, text);
      if (res.status === "ok" && res.response !== undefined) {
        const assistantMsg: Message = {
          role: "assistant",
          content: res.response,
          timestamp: Math.floor(Date.now() / 1000),
        };
        set((s) => ({ messages: [...s.messages, assistantMsg] }));
      } else {
        const errBody = res.message || "Ошибка при отправке";
        toaster.toast({ title: "ClaudeDeck", body: errBody });
      }
    } catch (e) {
      console.error("send_message error", e);
      toaster.toast({ title: "ClaudeDeck", body: "Ошибка соединения с backend" });
    } finally {
      set({ sending: false });
      // Refresh conversation list to update title/count
      get().loadConversations();
    }
  },

  clearActive: () => {
    set({ activeConversationId: null, messages: [] });
  },
}));

export function _resetForTesting(): void {
  useChatStore.setState({
    activeTab: "chat",
    conversations: [],
    activeConversationId: null,
    messages: [],
    sending: false,
    loadingConversations: false,
    loadingMessages: false,
  });
}
