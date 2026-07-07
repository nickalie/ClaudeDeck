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

vi.mock("@decky/ui", () => ({
  Router: { MainRunningApp: undefined },
}));

import { useChatStore, _resetForTesting } from "./chatStore";

async function waitForDone(timeoutMs = 500): Promise<void> {
  const start = Date.now();
  while (useChatStore.getState().sending) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for sending=false");
    await new Promise((r) => setTimeout(r, 10));
  }
}

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
        title: "New chat",
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
      useChatStore.setState({
        activeConversationId: "abc",
        messages: [{ role: "user", content: "x", timestamp: 1 }],
      });
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
    it("auto-creates conversation if none active and streams items", async () => {
      const conv = {
        id: "auto1",
        title: "New chat",
        session_id: null,
        messages: [],
        created_at: 1000,
        updated_at: 1000,
      };
      mockApiFns["create_conversation"].mockResolvedValue({
        status: "ok",
        conversation: conv,
      });
      mockApiFns["send_message"].mockResolvedValue({ status: "streaming" });
      mockApiFns["get_stream"].mockResolvedValue({
        items: [{ type: "text", content: "Hello!" }],
        done: true,
        error: null,
        session_id: "s1",
        cost_usd: 0,
      });
      mockApiFns["get_conversations"].mockResolvedValue([]);

      await useChatStore.getState().sendMessage("Hi");
      await waitForDone();

      const state = useChatStore.getState();
      expect(state.messages).toHaveLength(2);
      expect(state.messages[0].role).toBe("user");
      expect(state.messages[0].content).toBe("Hi");
      expect(state.messages[1].role).toBe("assistant");
      expect(state.messages[1].content).toBe("Hello!");
      expect(state.messages[1].item_type).toBe("text");
      expect(state.sending).toBe(false);
    });

    it("streams multiple items as separate messages", async () => {
      useChatStore.setState({ activeConversationId: "exist1" });
      mockApiFns["send_message"].mockResolvedValue({ status: "streaming" });
      mockApiFns["get_stream"].mockResolvedValue({
        items: [
          { type: "text", content: "Let me check." },
          {
            type: "tool_use",
            tool_name: "Bash",
            tool_input: { command: "ls" },
            tool_use_id: "t1",
          },
          { type: "tool_result", content: "file.txt", tool_use_id: "t1" },
          { type: "text", content: "Found it." },
        ],
        done: true,
        error: null,
        session_id: null,
        cost_usd: 0,
      });
      mockApiFns["get_conversations"].mockResolvedValue([]);

      await useChatStore.getState().sendMessage("Check");
      await waitForDone();

      const msgs = useChatStore.getState().messages;
      expect(msgs).toHaveLength(5);
      expect(msgs[0].role).toBe("user");
      expect(msgs[1].item_type).toBe("text");
      expect(msgs[2].item_type).toBe("tool_use");
      expect(msgs[2].tool_name).toBe("Bash");
      expect(msgs[3].item_type).toBe("tool_result");
      expect(msgs[4].item_type).toBe("text");
    });

    it("shows toast on backend error", async () => {
      useChatStore.setState({ activeConversationId: "exist1" });
      mockApiFns["send_message"].mockResolvedValue({
        status: "error",
        message: "CLI not found",
      });
      mockApiFns["get_conversations"].mockResolvedValue([]);

      await useChatStore.getState().sendMessage("Hello");

      // User message saved optimistically; error added as assistant message
      const msgs = useChatStore.getState().messages;
      expect(msgs).toHaveLength(2);
      expect(msgs[0].role).toBe("user");
      expect(msgs[1].role).toBe("assistant");
      expect(msgs[1].content).toContain("CLI not found");
      expect(useChatStore.getState().sending).toBe(false);
    });

    it("handles network error", async () => {
      useChatStore.setState({ activeConversationId: "exist1" });
      mockApiFns["send_message"].mockRejectedValue(new Error("network"));
      mockApiFns["get_conversations"].mockResolvedValue([]);

      await useChatStore.getState().sendMessage("Hello");

      expect(useChatStore.getState().sending).toBe(false);
      const msgs = useChatStore.getState().messages;
      expect(msgs[msgs.length - 1].role).toBe("assistant");
    });

    it("shows error when stream finishes with error and no items", async () => {
      useChatStore.setState({ activeConversationId: "exist1" });
      mockApiFns["send_message"].mockResolvedValue({ status: "streaming" });
      mockApiFns["get_stream"].mockResolvedValue({
        items: [],
        done: true,
        error: "Auth failed",
        session_id: null,
        cost_usd: 0,
      });
      mockApiFns["get_conversations"].mockResolvedValue([]);

      await useChatStore.getState().sendMessage("Hi");
      await waitForDone();

      const msgs = useChatStore.getState().messages;
      expect(msgs[msgs.length - 1].content).toContain("Auth failed");
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
