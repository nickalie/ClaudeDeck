import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockApiFns, mockToast } = vi.hoisted(() => {
  const mockApiFns: Record<string, ReturnType<typeof vi.fn>> = {};
  const mockToast = vi.fn();
  return { mockApiFns, mockToast };
});

vi.mock("@decky/api", () => ({
  callable: vi.fn((name: string) => {
    if (!mockApiFns[name]) mockApiFns[name] = vi.fn();
    return mockApiFns[name];
  }),
  toaster: { toast: mockToast },
}));

import { useChatStore, _resetForTesting } from "./chatStore";

beforeEach(() => {
  _resetForTesting();
  vi.clearAllMocks();
  for (const key of Object.keys(mockApiFns)) {
    mockApiFns[key].mockReset();
  }
});

describe("chatStore", () => {
  describe("initial state", () => {
    it("starts with empty state", () => {
      const state = useChatStore.getState();
      expect(state.conversations).toEqual([]);
      expect(state.activeConversationId).toBeNull();
      expect(state.messages).toEqual([]);
      expect(state.sending).toBe(false);
      expect(state.activeTab).toBe("chat");
    });
  });

  describe("setTab", () => {
    it("switches active tab", () => {
      useChatStore.getState().setTab("history");
      expect(useChatStore.getState().activeTab).toBe("history");
    });
  });

  describe("loadConversations", () => {
    it("loads conversation list from backend", async () => {
      const mockList = [
        { id: "abc", title: "Test", message_count: 2, updated_at: 1000 },
      ];
      mockApiFns["get_conversations"].mockResolvedValue(mockList);

      await useChatStore.getState().loadConversations();

      expect(useChatStore.getState().conversations).toEqual(mockList);
      expect(useChatStore.getState().loadingConversations).toBe(false);
    });

    it("handles error gracefully", async () => {
      mockApiFns["get_conversations"].mockRejectedValue(new Error("fail"));

      await useChatStore.getState().loadConversations();

      expect(useChatStore.getState().conversations).toEqual([]);
      expect(useChatStore.getState().loadingConversations).toBe(false);
    });
  });

  describe("loadConversation", () => {
    it("loads messages from a conversation", async () => {
      const conv = {
        id: "abc",
        title: "Test",
        session_id: null,
        messages: [
          { role: "user", content: "Hello", timestamp: 1000 },
          { role: "assistant", content: "Hi!", timestamp: 1001 },
        ],
        created_at: 1000,
        updated_at: 1001,
      };
      mockApiFns["load_conversation"].mockResolvedValue({
        status: "ok",
        conversation: conv,
      });

      await useChatStore.getState().loadConversation("abc");

      expect(useChatStore.getState().activeConversationId).toBe("abc");
      expect(useChatStore.getState().messages).toHaveLength(2);
      expect(useChatStore.getState().loadingMessages).toBe(false);
    });

    it("shows toast on error", async () => {
      mockApiFns["load_conversation"].mockResolvedValue({
        status: "error",
        message: "not found",
      });

      await useChatStore.getState().loadConversation("bad");

      expect(mockToast).toHaveBeenCalled();
    });
  });

  describe("createConversation", () => {
    it("creates a new conversation and sets it active", async () => {
      const conv = {
        id: "new1",
        title: "Новый чат",
        session_id: null,
        messages: [],
        created_at: 1000,
        updated_at: 1000,
      };
      mockApiFns["create_conversation"].mockResolvedValue({
        status: "ok",
        conversation: conv,
      });
      mockApiFns["get_conversations"].mockResolvedValue([]);

      const id = await useChatStore.getState().createConversation();

      expect(id).toBe("new1");
      expect(useChatStore.getState().activeConversationId).toBe("new1");
      expect(useChatStore.getState().messages).toEqual([]);
    });
  });

  describe("deleteConversation", () => {
    it("deletes and clears active if same", async () => {
      useChatStore.setState({ activeConversationId: "abc", messages: [{ role: "user", content: "x", timestamp: 1 }] });
      mockApiFns["delete_conversation"].mockResolvedValue({ status: "ok" });
      mockApiFns["get_conversations"].mockResolvedValue([]);

      await useChatStore.getState().deleteConversation("abc");

      expect(useChatStore.getState().activeConversationId).toBeNull();
      expect(useChatStore.getState().messages).toEqual([]);
    });

    it("does not clear active if different", async () => {
      useChatStore.setState({ activeConversationId: "other" });
      mockApiFns["delete_conversation"].mockResolvedValue({ status: "ok" });
      mockApiFns["get_conversations"].mockResolvedValue([]);

      await useChatStore.getState().deleteConversation("abc");

      expect(useChatStore.getState().activeConversationId).toBe("other");
    });
  });

  describe("sendMessage", () => {
    it("auto-creates conversation if none active", async () => {
      const conv = {
        id: "auto1",
        title: "Новый чат",
        session_id: null,
        messages: [],
        created_at: 1000,
        updated_at: 1000,
      };
      mockApiFns["create_conversation"].mockResolvedValue({
        status: "ok",
        conversation: conv,
      });
      mockApiFns["send_message"].mockResolvedValue({
        status: "ok",
        response: "Hello!",
      });
      mockApiFns["get_conversations"].mockResolvedValue([]);

      await useChatStore.getState().sendMessage("Hi");

      const state = useChatStore.getState();
      expect(state.messages).toHaveLength(2);
      expect(state.messages[0].role).toBe("user");
      expect(state.messages[0].content).toBe("Hi");
      expect(state.messages[1].role).toBe("assistant");
      expect(state.messages[1].content).toBe("Hello!");
      expect(state.sending).toBe(false);
    });

    it("sends to existing conversation", async () => {
      useChatStore.setState({ activeConversationId: "exist1" });
      mockApiFns["send_message"].mockResolvedValue({
        status: "ok",
        response: "Response",
      });
      mockApiFns["get_conversations"].mockResolvedValue([]);

      await useChatStore.getState().sendMessage("Question");

      const state = useChatStore.getState();
      expect(state.messages).toHaveLength(2);
      expect(mockApiFns["send_message"]).toHaveBeenCalledWith("exist1", "Question");
    });

    it("shows toast on backend error", async () => {
      useChatStore.setState({ activeConversationId: "exist1" });
      mockApiFns["send_message"].mockResolvedValue({
        status: "error",
        message: "CLI not found",
      });
      mockApiFns["get_conversations"].mockResolvedValue([]);

      await useChatStore.getState().sendMessage("Hello");

      expect(mockToast).toHaveBeenCalled();
      // User message still added optimistically
      expect(useChatStore.getState().messages).toHaveLength(1);
    });

    it("handles network error", async () => {
      useChatStore.setState({ activeConversationId: "exist1" });
      mockApiFns["send_message"].mockRejectedValue(new Error("network"));
      mockApiFns["get_conversations"].mockResolvedValue([]);

      await useChatStore.getState().sendMessage("Hello");

      expect(mockToast).toHaveBeenCalled();
      expect(useChatStore.getState().sending).toBe(false);
    });
  });

  describe("clearActive", () => {
    it("clears active conversation", () => {
      useChatStore.setState({
        activeConversationId: "abc",
        messages: [{ role: "user", content: "x", timestamp: 1 }],
      });

      useChatStore.getState().clearActive();

      expect(useChatStore.getState().activeConversationId).toBeNull();
      expect(useChatStore.getState().messages).toEqual([]);
    });
  });
});
