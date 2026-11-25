import React, { useState } from "react";
import {
  AlertTriangle,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Lock,
  Moon,
  RefreshCw,
  Shield,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../api";
import { getStrings, LANGUAGES } from "../i18n";
import type { AppPreferences, UpdateCheckResult, VaultStatus } from "../types";

interface SettingsModalProps {
  preferences: AppPreferences;
  vaultStatus: VaultStatus;
  onClose: () => void;
  onPreferencesChange: (next: AppPreferences) => void;
  onVaultStatusChange: (next: VaultStatus) => void;
  onVaultUnlocked: () => void;
  onVaultDestroyed: (alsoWipedPublic: boolean) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  preferences,
  vaultStatus,
  onClose,
  onPreferencesChange,
  onVaultStatusChange,
  onVaultUnlocked,
  onVaultDestroyed,
}) => {
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [currentPass, setCurrentPass] = useState("");
  const [manualUnlockPass, setManualUnlockPass] = useState("");
  const [showPass, setShowPass] = useState(false);

  const [wipePass, setWipePass] = useState("");
  const [wipeConfirmText, setWipeConfirmText] = useState("");
  const [wipeChecked, setWipeChecked] = useState(false);
  const [alsoWipePublic, setAlsoWipePublic] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  const t = getStrings(preferences.language);

  const handleCheckUpdate = async () => {
    setError(null);
    setSuccess(null);
    setCheckingUpdate(true);
    try {
      const res = await api.checkForUpdates();
      setUpdateInfo(res);
      if (!res.update_available) {
        setSuccess(`${t.upToDate} (v${res.current_version}).`);
      } else if (res.download_url) {
        setSuccess(`${t.newVersionFound} (v${res.latest_version})`);
        setBusy(true);
        const msg = await api.installGithubUpdate(res.download_url);
        setSuccess(msg);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleSetupVault = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (newPass.trim().length < 4) {
      setError(t.passTooShort);
      return;
    }
    if (newPass !== confirmPass) {
      setError(t.passMismatch);
      return;
    }
    setBusy(true);
    try {
      const status = await api.setupVault(newPass);
      setNewPass("");
      setConfirmPass("");
      onVaultStatusChange(status);
      onVaultUnlocked();
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleChangePass = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (newPass !== confirmPass) {
      setError(t.passMismatch);
      return;
    }
    setBusy(true);
    try {
      await api.changePassphrase(currentPass, newPass);
      setCurrentPass("");
      setNewPass("");
      setConfirmPass("");
      setSuccess(t.passUpdated);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleManualUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const ok = await api.tryUnlockVault(manualUnlockPass);
      if (ok) {
        setManualUnlockPass("");
        onVaultUnlocked();
        onClose();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDestroyVault = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!wipeChecked || wipeConfirmText.trim().toUpperCase() !== "APAGAR TUDO") {
      setError(t.wipeNeedConfirm);
      return;
    }
    setBusy(true);
    try {
      await api.verifyAndDestroyVault(wipePass, true, alsoWipePublic);
      const st = await api.getVaultStatus();
      onVaultStatusChange(st);
      onVaultDestroyed(alsoWipePublic);
      setWipePass("");
      setWipeConfirmText("");
      setWipeChecked(false);
      setSuccess(t.vaultDestroyedMsg);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <Shield size={17} style={{ color: "var(--accent)" }} />
            {t.settingsTitle}
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={17} />
          </button>
        </div>

        {error && <div className="alert-banner">{error}</div>}
        {success && <div className="success-banner">{success}</div>}

        {/* Language selector */}
        <div className="setting-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
          <div className="setting-info">
            <strong style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Globe size={13} /> {t.languageLabel}
            </strong>
            <span>{t.languageSub}</span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {LANGUAGES.map((l) => {
              const active = (preferences.language ?? "pt") === l.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  className={`btn ${active ? "btn-primary" : ""}`}
                  style={{ flex: 1, padding: "7px 8px", fontSize: 12 }}
                  onClick={() =>
                    onPreferencesChange({
                      ...preferences,
                      language: l.id,
                    })
                  }
                >
                  {l.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Appearance & Preferences */}
        <div className="setting-row">
          <div className="setting-info">
            <strong>{t.themeLabel}</strong>
            <span>{t.themeSub}</span>
          </div>
          <button
            className="btn"
            onClick={() =>
              onPreferencesChange({
                ...preferences,
                theme: preferences.theme === "dark" ? "light" : "dark",
              })
            }
          >
            {preferences.theme === "dark" ? (
              <>
                <Sun size={14} /> {t.lightMode}
              </>
            ) : (
              <>
                <Moon size={14} /> {t.darkMode}
              </>
            )}
          </button>
        </div>

        <div className="setting-row">
          <div className="setting-info">
            <strong>{t.autoLockLabel}</strong>
            <span>{t.autoLockSub}</span>
          </div>
          <select
            className="field-input"
            style={{ width: 130 }}
            value={preferences.auto_lock_seconds}
            onChange={(e) =>
              onPreferencesChange({
                ...preferences,
                auto_lock_seconds: Number(e.target.value),
              })
            }
          >
            <option value={60}>{t.min1}</option>
            <option value={180}>{t.min3}</option>
            <option value={300}>{t.min5}</option>
            <option value={900}>{t.min15}</option>
            <option value={0}>{t.disabled}</option>
          </select>
        </div>

        <div className="setting-row">
          <div className="setting-info">
            <strong>{t.screenProtectLabel}</strong>
            <span>{t.screenProtectSub}</span>
          </div>
          <input
            type="checkbox"
            checked={preferences.screen_protect}
            onChange={(e) =>
              onPreferencesChange({
                ...preferences,
                screen_protect: e.target.checked,
              })
            }
          />
        </div>

        <div className="setting-row">
          <div className="setting-info">
            <strong>{t.stealthTriggerLabel}</strong>
            <span>{t.stealthTriggerSub}</span>
          </div>
          <input
            type="checkbox"
            checked={preferences.stealth_trigger_enabled}
            onChange={(e) =>
              onPreferencesChange({
                ...preferences,
                stealth_trigger_enabled: e.target.checked,
              })
            }
          />
        </div>

        <div className="setting-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: "100%" }}
            disabled={checkingUpdate || busy}
            onClick={handleCheckUpdate}
          >
            <RefreshCw size={14} />
            {checkingUpdate ? t.searchingUpdates : t.searchUpdates}
          </button>
          {updateInfo && updateInfo.update_available && !updateInfo.download_url && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 9,
                background: "var(--vault-soft)",
                fontSize: 12,
              }}
            >
              <span>
                {t.newVersionAvailable} <strong>v{updateInfo.latest_version}</strong>
              </span>
              <a
                href={updateInfo.release_url}
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--accent)", fontWeight: 600 }}
              >
                {t.openRelease}
              </a>
            </div>
          )}
        </div>

        {/* Vault Setup or Unlock/Change */}
        {!vaultStatus.exists ? (
          <form onSubmit={handleSetupVault} className="field-group">
            <div className="field-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <KeyRound size={13} /> {t.createPassTitle}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
              {t.createPassDesc}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type={showPass ? "text" : "password"}
                className="field-input"
                placeholder={t.passphrasePlaceholder}
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
              />
              <button
                type="button"
                className="btn"
                onClick={() => setShowPass((v) => !v)}
              >
                {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <input
              type={showPass ? "text" : "password"}
              className="field-input"
              placeholder={t.confirmPassPlaceholder}
              value={confirmPass}
              onChange={(e) => setConfirmPass(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={busy}>
              <Lock size={14} /> {t.activateVault}
            </button>
          </form>
        ) : (
          <>
            {!vaultStatus.unlocked && (
              <form onSubmit={handleManualUnlock} className="field-group">
                <div className="field-label">{t.manualUnlockLabel}</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type={showPass ? "text" : "password"}
                    className="field-input"
                    placeholder={t.passphrasePlaceholder}
                    value={manualUnlockPass}
                    onChange={(e) => setManualUnlockPass(e.target.value)}
                  />
                  <button type="submit" className="btn btn-primary" disabled={busy}>
                    {t.openBtn}
                  </button>
                </div>
              </form>
            )}

            <form onSubmit={handleChangePass} className="field-group">
              <div className="field-label">{t.changePassLabel}</div>
              <input
                type={showPass ? "text" : "password"}
                className="field-input"
                placeholder={t.currentPassPlaceholder}
                value={currentPass}
                onChange={(e) => setCurrentPass(e.target.value)}
              />
              <input
                type={showPass ? "text" : "password"}
                className="field-input"
                placeholder={t.newPassPlaceholder}
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
              />
              <input
                type={showPass ? "text" : "password"}
                className="field-input"
                placeholder={t.confirmNewPassPlaceholder}
                value={confirmPass}
                onChange={(e) => setConfirmPass(e.target.value)}
              />
              <button type="submit" className="btn" disabled={busy}>
                <KeyRound size={14} /> {t.updatePassBtn}
              </button>
            </form>

            {/* Protected Deletion Zone */}
            <form onSubmit={handleDestroyVault} className="danger-zone">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--danger)",
                }}
              >
                <AlertTriangle size={15} /> {t.dangerZoneTitle}
              </div>
              <span style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>
                {t.dangerZoneDesc}
              </span>
              <input
                type="password"
                className="field-input"
                placeholder={t.currentPassPlaceholder}
                value={wipePass}
                onChange={(e) => setWipePass(e.target.value)}
              />
              <input
                type="text"
                className="field-input"
                placeholder={t.confirmDestroyPlaceholder}
                value={wipeConfirmText}
                onChange={(e) => setWipeConfirmText(e.target.value)}
              />
              <label className="checkbox-confirm">
                <input
                  type="checkbox"
                  checked={wipeChecked}
                  onChange={(e) => setWipeChecked(e.target.checked)}
                />
                <span>{t.confirmDestroyCheck}</span>
              </label>
              <label className="checkbox-confirm">
                <input
                  type="checkbox"
                  checked={alsoWipePublic}
                  onChange={(e) => setAlsoWipePublic(e.target.checked)}
                />
                <span>{t.alsoWipePublic}</span>
              </label>
              <button
                type="submit"
                className="btn btn-danger"
                disabled={
                  busy ||
                  !wipeChecked ||
                  wipeConfirmText.trim().toUpperCase() !== "APAGAR TUDO" ||
                  !wipePass
                }
              >
                <Trash2 size={14} /> {t.destroyVaultBtn}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};
