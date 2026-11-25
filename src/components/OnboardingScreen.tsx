import React, { useEffect, useState } from "react";
import {
  AlertOctagon,
  Check,
  Copy,
  Globe,
  KeyRound,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { api } from "../api";
import { getStrings, LANGUAGES } from "../i18n";
import type { Language, PublicStore } from "../types";

interface OnboardingScreenProps {
  initialLanguage: Language;
  onLanguageChange: (lang: Language) => void;
  onCompleted: (store: PublicStore) => void;
}

export const OnboardingScreen: React.FC<OnboardingScreenProps> = ({
  initialLanguage,
  onLanguageChange,
  onCompleted,
}) => {
  const [lang, setLang] = useState<Language>(initialLanguage);
  const [recoveryKey, setRecoveryKey] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const t = getStrings(lang);

  const loadNewKey = async () => {
    setError(null);
    try {
      const k = await api.generateRecoveryKey();
      setRecoveryKey(k);
      setCopied(false);
    } catch (err) {
      setError(String(err));
    }
  };

  useEffect(() => {
    loadNewKey();
  }, []);

  const handleCopy = async () => {
    if (!recoveryKey) return;
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback ignored
    }
  };

  const handleSubmit = async () => {
    if (!confirmed || !recoveryKey) return;
    setBusy(true);
    setError(null);
    try {
      const store = await api.completeOnboarding(recoveryKey, lang);
      onCompleted(store);
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  return (
    <div
      className="app-shell theme-dark"
      style={{
        background: "linear-gradient(160deg, #3b0a14 0%, #19060d 55%, #0f0714 100%)",
        borderColor: "rgba(248, 113, 113, 0.5)",
      }}
    >
      <header className="titlebar" data-tauri-drag-region>
        <div className="titlebar-left" data-tauri-drag-region>
          <div
            className="brand-mark"
            style={{ background: "rgba(239, 68, 68, 0.22)", color: "#fca5a5" }}
          >
            <ShieldAlert size={16} />
          </div>
          <div className="brand-title" data-tauri-drag-region style={{ fontSize: 13.5, color: "#fecaca" }}>
            {t.onboardingTitle}
          </div>
        </div>
        <div className="titlebar-actions">
          <button
            className="icon-btn danger"
            title={t.closeTip}
            onClick={() => api.exitApp()}
          >
            <X size={15} />
          </button>
        </div>
      </header>

      <main className="main-scroll" style={{ gap: 11, paddingTop: 2 }}>
        <div style={{ fontSize: 12, color: "#fca5a5", fontWeight: 600 }}>
          {t.onboardingSubtitle}
        </div>

        {/* Language Picker */}
        <div
          style={{
            background: "rgba(127, 29, 29, 0.34)",
            border: "1px solid rgba(248, 113, 113, 0.35)",
            borderRadius: 12,
            padding: 10,
            display: "flex",
            flexDirection: "column",
            gap: 7,
          }}
        >
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "#fecaca", display: "flex", alignItems: "center", gap: 6 }}>
            <Globe size={13} /> {t.onboardingLangLabel}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {LANGUAGES.map((l) => {
              const active = lang === l.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  className="btn"
                  style={{
                    flex: 1,
                    padding: "7px 8px",
                    fontSize: 12,
                    background: active ? "#ef4444" : "rgba(0, 0, 0, 0.28)",
                    borderColor: active ? "#fca5a5" : "rgba(248, 113, 113, 0.28)",
                    color: "#ffffff",
                  }}
                  onClick={() => {
                    setLang(l.id);
                    onLanguageChange(l.id);
                  }}
                >
                  {l.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Security Layers Summary */}
        <div
          style={{
            background: "rgba(0, 0, 0, 0.28)",
            border: "1px solid rgba(248, 113, 113, 0.28)",
            borderRadius: 12,
            padding: 11,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            fontSize: 12,
            lineHeight: 1.45,
          }}
        >
          <div style={{ fontWeight: 700, color: "#ffffff", display: "flex", alignItems: "center", gap: 6 }}>
            <ShieldCheck size={14} style={{ color: "#34d399" }} />
            {t.onboardingFeaturesTitle}
          </div>
          <div style={{ color: "#e2e8f0" }}>• {t.onboardingFeat1}</div>
          <div style={{ color: "#e2e8f0" }}>• {t.onboardingFeat2}</div>
          <div style={{ color: "#e2e8f0" }}>• {t.onboardingFeat3}</div>
        </div>

        {/* Uninstall / Deletion Lock Warning */}
        <div
          style={{
            background: "rgba(220, 38, 38, 0.24)",
            border: "1px solid rgba(248, 113, 113, 0.55)",
            borderRadius: 12,
            padding: 11,
            display: "flex",
            flexDirection: "column",
            gap: 5,
            fontSize: 12,
            lineHeight: 1.45,
          }}
        >
          <div style={{ fontWeight: 700, color: "#fecaca", display: "flex", alignItems: "center", gap: 6 }}>
            <AlertOctagon size={14} style={{ color: "#f87171" }} />
            {t.onboardingLockWarnTitle}
          </div>
          <div style={{ color: "#fee2e2" }}>{t.onboardingLockWarnBody}</div>
        </div>

        {/* 24-Char Recovery Key Generator */}
        <div
          style={{
            background: "rgba(0, 0, 0, 0.36)",
            border: "1px solid rgba(248, 113, 113, 0.45)",
            borderRadius: 12,
            padding: 11,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#fde68a", display: "flex", alignItems: "center", gap: 6 }}>
            <KeyRound size={14} /> {t.onboardingRecoveryTitle}
          </div>
          <div style={{ fontSize: 11.5, color: "#f1f5f9", lineHeight: 1.45 }}>
            {t.onboardingRecoveryExplain}
          </div>

          <div
            style={{
              background: "rgba(10, 12, 22, 0.85)",
              border: "1px solid rgba(253, 230, 138, 0.45)",
              borderRadius: 10,
              padding: "10px 12px",
              fontFamily: '"Cascadia Code", Consolas, monospace',
              fontSize: 13.5,
              fontWeight: 700,
              letterSpacing: "0.06em",
              color: "#fef08a",
              textAlign: "center",
              userSelect: "all",
            }}
          >
            {recoveryKey || "..."}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn"
              style={{ flex: 1, background: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.18)" }}
              onClick={loadNewKey}
            >
              <RefreshCw size={13} /> {t.onboardingGenNew}
            </button>
            <button
              type="button"
              className="btn"
              style={{
                flex: 1,
                background: copied ? "rgba(16, 185, 129, 0.25)" : "rgba(255,255,255,0.12)",
                borderColor: copied ? "#34d399" : "rgba(255,255,255,0.22)",
              }}
              onClick={handleCopy}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? t.onboardingCopied : t.onboardingCopyKey}
            </button>
          </div>
        </div>

        {error && <div className="alert-banner">{error}</div>}

        <label className="checkbox-confirm" style={{ color: "#fee2e2", padding: "2px 2px" }}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>{t.onboardingConfirmCheck}</span>
        </label>

        <button
          type="button"
          className="btn btn-danger"
          style={{
            width: "100%",
            padding: "11px 14px",
            fontSize: 13,
            fontWeight: 700,
            background: "#dc2626",
          }}
          disabled={!confirmed || !recoveryKey || busy}
          onClick={handleSubmit}
        >
          <Lock size={14} /> {t.onboardingEnterBtn}
        </button>
      </main>
    </div>
  );
};
