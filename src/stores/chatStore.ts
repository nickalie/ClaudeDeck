import { create } from "zustand";
import { callable, toaster } from "@decky/api";
import { Router } from "@decky/ui";

export type MessageItemType = "text" | "thinking" | "tool_use" | "tool_result";

export interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  item_type?: MessageItemType;
  tool_name?: string;
  tool_input?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
}

export interface StreamItem {
  type: MessageItemType;
  content?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
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

export interface Settings {
  claude_path: string;
  http_proxy: string;
}

interface ChatState {
  activeTab: string;
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  messages: Message[];
  sending: boolean;
  loadingConversations: boolean;
  loadingMessages: boolean;
  settings: Settings;
  loadingSettings: boolean;

  setTab: (tab: string) => void;
  loadConversations: () => Promise<void>;
  loadConversation: (id: string) => Promise<void>;
  createConversation: () => Promise<string | null>;
  deleteConversation: (id: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  stopGeneration: () => Promise<void>;
  clearActive: () => void;
  loadSettings: () => Promise<void>;
  saveSettings: (settings: Settings) => Promise<boolean>;
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
  [string, string, string],
  { status: string; message?: string }
>("send_message");
const rpcGetStream = callable<
  [],
  {
    items: StreamItem[];
    done: boolean;
    error: string | null;
    session_id: string | null;
    cost_usd: number;
  }
>("get_stream");
const rpcStopClaude = callable<[], { status: string }>("stop_claude");
const rpcGetSettings = callable<[], Settings>("get_settings");
const rpcSaveSettings = callable<[string], { status: string }>("save_settings");

function streamItemToMessage(item: StreamItem): Message {
  return {
    role: "assistant",
    content: item.content || "",
    timestamp: Math.floor(Date.now() / 1000),
    item_type: item.type,
    tool_name: item.tool_name,
    tool_input: item.tool_input,
    tool_use_id: item.tool_use_id,
    is_error: item.is_error,
  };
}

function getRunningGameName(): string {
  try {
    // Steam internal API available in Decky's CEF environment
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const app = (Router as any)?.MainRunningApp;
    return app?.display_name || "";
  } catch {
    return "";
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  activeTab: "chat",
  conversations: [],
  activeConversationId: null,
  messages: [],
  sending: false,
  loadingConversations: false,
  loadingMessages: false,
  settings: { claude_path: "claude", http_proxy: "" },
  loadingSettings: false,

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

    if (!convId) {
      convId = await state.createConversation();
      if (!convId) {
        toaster.toast({ title: "ClaudeDeck", body: "Не удалось создать диалог" });
        return;
      }
    }

    const userMsg: Message = {
      role: "user",
      content: text,
      timestamp: Math.floor(Date.now() / 1000),
    };
    set((s) => ({ messages: [...s.messages, userMsg], sending: true }));

    try {
      const res = await rpcSendMessage(convId, text, getRunningGameName());
      if (res.status !== "streaming") {
        const errMsg: Message = {
          role: "assistant",
          content: `**Ошибка:** ${res.message || "Ошибка при отправке"}`,
          timestamp: Math.floor(Date.now() / 1000),
        };
        set((s) => ({ messages: [...s.messages, errMsg], sending: false }));
        get().loadConversations();
        return;
      }
    } catch (e) {
      console.error("send_message error", e);
      const errMsg: Message = {
        role: "assistant",
        content: "**Ошибка:** Ошибка соединения с backend",
        timestamp: Math.floor(Date.now() / 1000),
      };
      set((s) => ({ messages: [...s.messages, errMsg], sending: false }));
      return;
    }

    // Poll stream
    let added = 0;
    let pollErrors = 0;
    const poll = async () => {
      try {
        const stream = await rpcGetStream();
        pollErrors = 0;
        const items = stream.items || [];
        if (items.length > added) {
          const newMsgs = items.slice(added).map(streamItemToMessage);
          added = items.length;
          set((s) => ({ messages: [...s.messages, ...newMsgs] }));
        }

        if (stream.done) {
          if (stream.error) {
            set((s) => ({
              messages: [
                ...s.messages,
                {
                  role: "assistant" as const,
                  content: `**Ошибка:** ${stream.error}`,
                  timestamp: Math.floor(Date.now() / 1000),
                },
              ],
            }));
          }
          set({ sending: false });
          get().loadConversations();
          return;
        }

        setTimeout(poll, 200);
      } catch (e) {
        console.error("Stream poll error", e);
        // A transient RPC hiccup shouldn't abandon a stream that is still
        // running server-side. Retry a few times before giving up, and
        // refresh from disk so a reply finalized meanwhile still shows.
        pollErrors += 1;
        if (pollErrors >= 5) {
          set({ sending: false });
          const cid = get().activeConversationId;
          if (cid) get().loadConversation(cid);
          else get().loadConversations();
          return;
        }
        setTimeout(poll, 200);
      }
    };
    poll();
  },

  stopGeneration: async () => {
    try {
      await rpcStopClaude();
    } catch (e) {
      console.error("Failed to stop claude", e);
    }
  },

  loadSettings: async () => {
    set({ loadingSettings: true });
    try {
      const s = await rpcGetSettings();
      set({ settings: s });
    } catch (e) {
      console.error("Failed to load settings", e);
    } finally {
      set({ loadingSettings: false });
    }
  },

  saveSettings: async (settings: Settings) => {
    try {
      const res = await rpcSaveSettings(JSON.stringify(settings));
      if (res.status === "ok") {
        set({ settings });
        toaster.toast({ title: "ClaudeDeck", body: "Настройки сохранены" });
        return true;
      }
      toaster.toast({ title: "ClaudeDeck", body: "Ошибка сохранения" });
    } catch (e) {
      console.error("Failed to save settings", e);
      toaster.toast({ title: "ClaudeDeck", body: "Ошибка сохранения" });
    }
    return false;
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
    settings: { claude_path: "claude", http_proxy: "" },
    loadingSettings: false,
  });
}
