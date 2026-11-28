import React, { useEffect, useState } from "react";
import { AlertTriangle, Lock, ShieldAlert, Trash2 } from "lucide-react";
import { api } from "../api";
import { getStrings } from "../i18n";
import type { Language } from "../types";

export const UninstallGate: React.FC = () => {
  const [passphrase, setPassphrase] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState<Language>("pt");

  useEffect(() => {
    api
      .getPublicStore()
      .then((s) => {
        if (s.preferences.language) setLang(s.preferences.language);
      })
      .catch(() => {});
  }, []);

  const t = getStrings(lang);

  const handleConfirmUninstall = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!confirmed || confirmText.trim().toUpperCase() !== t.confirmDestroyPhrase) {
      setError(t.wipeNeedConfirm);
      return;
    }
    setBusy(true);
    try {
      await api.verifyAndDestroyVault(passphrase, true, true);
      await api.completeUninstallGate(true);
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  return (
    <div className="app-shell theme-dark" style={{ padding: 20, justifyContent: "center" }}>
      <div className="modal-card" style={{ margin: "0 auto", maxWidth: 430 }}>
        <div className="modal-header">
          <div className="modal-title" style={{ color: "var(--danger)" }}>
            <ShieldAlert size={18} />
            {t.uninstallTitle}
          </div>
        </div>

        <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
          {t.uninstallDesc}
        </div>

        {error && <div className="alert-banner">{error}</div>}

        <form onSubmit={handleConfirmUninstall} className="field-group">
          <div className="field-label">
            <Lock size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />
            {t.uninstallPassLabel}
          </div>
          <input
            type="password"
            className="field-input"
            placeholder={t.passphrasePlaceholder}
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoFocus
          />

          <div className="field-label">{t.uninstallConfirmLabel}</div>
          <input
            type="text"
            className="field-input"
            placeholder={t.confirmDestroyPlaceholder}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
          />

          <label className="checkbox-confirm" style={{ marginTop: 4 }}>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>
              <AlertTriangle size={12} style={{ color: "var(--danger)", verticalAlign: "middle", marginRight: 4 }} />
              {t.uninstallCheck}
            </span>
          </label>

          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              type="button"
              className="btn"
              style={{ flex: 1 }}
              onClick={() => api.completeUninstallGate(false)}
              disabled={busy}
            >
              {t.cancel}
            </button>
            <button
              type="submit"
              className="btn btn-danger"
              style={{ flex: 1 }}
              disabled={
                busy ||
                !passphrase ||
                !confirmed ||
                confirmText.trim().toUpperCase() !== t.confirmDestroyPhrase
              }
            >
              <Trash2 size={14} /> {t.uninstallConfirmBtn}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
