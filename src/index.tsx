import { definePlugin, routerHook } from "@decky/api";
import {
  staticClasses,
  Tabs,
  PanelSection,
  PanelSectionRow,
  ButtonItem,
  Navigation,
} from "@decky/ui";
import { FaComments } from "react-icons/fa";
import { ChatView } from "./components/ChatView";
import { HistoryView } from "./components/HistoryView";
import { SettingsView } from "./components/SettingsView";
import { useChatStore } from "./stores/chatStore";

const ROUTE = "/claudedeck";

function ClaudeDeckPage() {
  const activeTab = useChatStore((s) => s.activeTab);
  const setTab = useChatStore((s) => s.setTab);

  return (
    <div style={{ marginTop: "40px", height: "calc(100vh - 40px)" }}>
      <Tabs
        activeTab={activeTab}
        onShowTab={(tabId: string) => setTab(tabId)}
        tabs={[
          {
            id: "chat",
            title: "Chat",
            content: <ChatView />,
          },
          {
            id: "history",
            title: "History",
            content: <HistoryView />,
          },
          {
            id: "settings",
            title: "Settings",
            content: <SettingsView />,
          },
        ]}
      />
    </div>
  );
}

function ClaudeDeckQAM() {
  return (
    <PanelSection>
      <PanelSectionRow>
        <ButtonItem
          label="ClaudeDeck"
          onClick={() => {
            Navigation.CloseSideMenus?.();
            Navigation.Navigate(ROUTE);
          }}
        >
          Open chat
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
}

export default definePlugin(() => {
  routerHook.addRoute(ROUTE, () => <ClaudeDeckPage />, { exact: true });

  return {
    name: "ClaudeDeck",
    titleView: (
      <div className={staticClasses.Title}>ClaudeDeck</div>
    ),
    icon: <FaComments />,
    content: <ClaudeDeckQAM />,
    onDismount() {
      routerHook.removeRoute(ROUTE);
    },
  };
});
