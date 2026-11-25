import React, { useState } from "react";
import {
  AlertTriangle,
  Download,
  Eye,
  EyeOff,
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

  const handleCheckUpdate = async () => {
    setError(null);
    setSuccess(null);
    setCheckingUpdate(true);
    try {
      const res = await api.checkForUpdates();
      setUpdateInfo(res);
      if (!res.update_available) {
        setSuccess(`LockPad já está na versão mais recente (v${res.current_version}).`);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleInstallUpdate = async () => {
    if (!updateInfo?.download_url) return;
    setError(null);
    setBusy(true);
    try {
      const msg = await api.installGithubUpdate(updateInfo.download_url);
      setSuccess(msg);
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  const handleSetupVault = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (newPass.trim().length < 4) {
      setError("A frase-chave precisa ter pelo menos 4 caracteres.");
      return;
    }
    if (newPass !== confirmPass) {
      setError("As frases-chave não coincidem.");
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
      setError("A nova frase-chave e a confirmação não coincidem.");
      return;
    }
    setBusy(true);
    try {
      await api.changePassphrase(currentPass, newPass);
      setCurrentPass("");
      setNewPass("");
      setConfirmPass("");
      setSuccess("Frase-chave atualizada com novo salt Argon2id.");
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
      setError('Marque a confirmação e digite "APAGAR TUDO" exatamente.');
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
      setSuccess("Cofre sobrescrito e apagado permanentemente.");
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
            Configurações & Segurança
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={17} />
          </button>
        </div>

        {error && <div className="alert-banner">{error}</div>}
        {success && <div className="success-banner">{success}</div>}

        {/* Appearance & Preferences */}
        <div className="setting-row">
          <div className="setting-info">
            <strong>Tema da Interface</strong>
            <span>Alterne entre modo claro e modo escuro</span>
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
                <Sun size={14} /> Claro
              </>
            ) : (
              <>
                <Moon size={14} /> Escuro
              </>
            )}
          </button>
        </div>

        <div className="setting-row">
          <div className="setting-info">
            <strong>Bloqueio Automático</strong>
            <span>Fecha e limpa a RAM após inatividade</span>
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
            <option value={60}>1 minuto</option>
            <option value={180}>3 minutos</option>
            <option value={300}>5 minutos</option>
            <option value={900}>15 minutos</option>
            <option value={0}>Desativado</option>
          </select>
        </div>

        <div className="setting-row">
          <div className="setting-info">
            <strong>Anti-Captura de Tela</strong>
            <span>Oculta a janela em prints/gravações quando o cofre está aberto</span>
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
            <strong>Gatilho Discreto nas Notas</strong>
            <span>Abre o cofre ao digitar a frase-chave em qualquer nota</span>
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div className="setting-info">
              <strong>Atualizações (GitHub)</strong>
              <span>Busca novas versões em github.com/Gartuja/LockPad</span>
            </div>
            <button
              type="button"
              className="btn"
              disabled={checkingUpdate || busy}
              onClick={handleCheckUpdate}
            >
              <RefreshCw size={13} />
              {checkingUpdate ? "Verificando..." : "Verificar Atualizações"}
            </button>
          </div>
          {updateInfo && updateInfo.update_available && (
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
                Nova versão disponível: <strong>v{updateInfo.latest_version}</strong>
              </span>
              {updateInfo.download_url ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={handleInstallUpdate}
                >
                  <Download size={13} /> Baixar e Atualizar
                </button>
              ) : (
                <a
                  href={updateInfo.release_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--accent)", fontWeight: 600 }}
                >
                  Abrir Release
                </a>
              )}
            </div>
          )}
        </div>

        {/* Vault Setup or Unlock/Change */}
        {!vaultStatus.exists ? (
          <form onSubmit={handleSetupVault} className="field-group">
            <div className="field-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <KeyRound size={13} /> Criar Frase-Chave do Cofre Secreto
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
              Depois de criada, escreva essa mesma frase em qualquer nota normal para abrir o seu Stick Note seguro (com textos, imagens, vídeos e pastas).
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type={showPass ? "text" : "password"}
                className="field-input"
                placeholder="Digite sua frase-chave secreta..."
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
              placeholder="Confirme a frase-chave..."
              value={confirmPass}
              onChange={(e) => setConfirmPass(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={busy}>
              <Lock size={14} /> Ativar Cofre Criptografado
            </button>
          </form>
        ) : (
          <>
            {!vaultStatus.unlocked && (
              <form onSubmit={handleManualUnlock} className="field-group">
                <div className="field-label">Abrir Cofre Manualmente</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type={showPass ? "text" : "password"}
                    className="field-input"
                    placeholder="Frase-chave do cofre..."
                    value={manualUnlockPass}
                    onChange={(e) => setManualUnlockPass(e.target.value)}
                  />
                  <button type="submit" className="btn btn-primary" disabled={busy}>
                    Abrir
                  </button>
                </div>
              </form>
            )}

            <form onSubmit={handleChangePass} className="field-group">
              <div className="field-label">Alterar Frase-Chave</div>
              <input
                type={showPass ? "text" : "password"}
                className="field-input"
                placeholder="Frase-chave atual..."
                value={currentPass}
                onChange={(e) => setCurrentPass(e.target.value)}
              />
              <input
                type={showPass ? "text" : "password"}
                className="field-input"
                placeholder="Nova frase-chave..."
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
              />
              <input
                type={showPass ? "text" : "password"}
                className="field-input"
                placeholder="Confirme a nova frase-chave..."
                value={confirmPass}
                onChange={(e) => setConfirmPass(e.target.value)}
              />
              <button type="submit" className="btn" disabled={busy}>
                <KeyRound size={14} /> Atualizar Frase-Chave
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
                <AlertTriangle size={15} /> Exclusão Protegida do Cofre
              </div>
              <span style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>
                O cofre e o aplicativo não podem ser apagados sem digitar sua frase-chave e confirmar que todos os dados serão destruídos.
              </span>
              <input
                type="password"
                className="field-input"
                placeholder="Digite sua frase-chave atual..."
                value={wipePass}
                onChange={(e) => setWipePass(e.target.value)}
              />
              <input
                type="text"
                className="field-input"
                placeholder='Digite "APAGAR TUDO" para confirmar'
                value={wipeConfirmText}
                onChange={(e) => setWipeConfirmText(e.target.value)}
              />
              <label className="checkbox-confirm">
                <input
                  type="checkbox"
                  checked={wipeChecked}
                  onChange={(e) => setWipeChecked(e.target.checked)}
                />
                <span>
                  Confirmo que todas as notas secretas, imagens, vídeos e pastas serão apagados permanentemente.
                </span>
              </label>
              <label className="checkbox-confirm">
                <input
                  type="checkbox"
                  checked={alsoWipePublic}
                  onChange={(e) => setAlsoWipePublic(e.target.checked)}
                />
                <span>Também apagar minhas notas normais (públicas)</span>
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
                <Trash2 size={14} /> Destruir Cofre Permanentemente
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};
