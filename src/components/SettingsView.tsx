import { Focusable, Spinner, TextField } from "@decky/ui";
import { useEffect, useState } from "react";
import { Settings, useChatStore } from "../stores/chatStore";

const STYLES = {
  wrapper: {
    padding: "12px 16px",
    height: "calc(100vh - 120px)",
    overflowY: "auto" as const,
  },
  field: {
    marginBottom: "16px",
  },
  label: {
    fontSize: "13px",
    fontWeight: "bold" as const,
    color: "#e0e0e0",
    marginBottom: "6px",
  },
  hint: {
    fontSize: "11px",
    color: "#888",
    marginTop: "4px",
  },
  saveBtn: {
    background: "#1a9fff",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    padding: "10px 20px",
    fontSize: "14px",
    fontWeight: "bold" as const,
    cursor: "pointer",
    textAlign: "center" as const,
    marginTop: "8px",
  },
  saveBtnDisabled: {
    opacity: 0.4,
  },
  empty: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
  },
};

export function SettingsView() {
  const settings = useChatStore((s) => s.settings);
  const loadingSettings = useChatStore((s) => s.loadingSettings);
  const loadSettings = useChatStore((s) => s.loadSettings);
  const saveSettings = useChatStore((s) => s.saveSettings);

  const [draft, setDraft] = useState<Settings>(settings);
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadSettings(); }, [loadSettings]);
  useEffect(() => { setDraft(settings); }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    await saveSettings(draft);
    setSaving(false);
  };

  if (loadingSettings) {
    return <div style={STYLES.empty}><Spinner /></div>;
  }

  const changed = draft.claude_path !== settings.claude_path
    || draft.http_proxy !== settings.http_proxy;

  return (
    <div style={STYLES.wrapper}>
      <div style={STYLES.field}>
        <div style={STYLES.label}>Claude CLI</div>
        <TextField
          value={draft.claude_path}
          onChange={(e) => setDraft({ ...draft, claude_path: e.target.value })}
        />
        <div style={STYLES.hint}>Путь к исполняемому файлу Claude CLI</div>
      </div>

      <div style={STYLES.field}>
        <div style={STYLES.label}>HTTP Proxy</div>
        <TextField
          value={draft.http_proxy}
          onChange={(e) => setDraft({ ...draft, http_proxy: e.target.value })}
        />
        <div style={STYLES.hint}>
          Прокси для Claude CLI и загрузки картинок (например http://192.168.1.100:3128)
        </div>
      </div>

      <Focusable
        style={{ ...STYLES.saveBtn, ...(!changed || saving ? STYLES.saveBtnDisabled : {}) }}
        onActivate={handleSave}
        onOKActionDescription="Сохранить настройки"
      >
        {saving ? "..." : "Сохранить"}
      </Focusable>
    </div>
  );
}
