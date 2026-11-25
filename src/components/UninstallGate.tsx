import React, { useState } from "react";
import { AlertTriangle, Lock, ShieldAlert, Trash2 } from "lucide-react";
import { api } from "../api";

export const UninstallGate: React.FC = () => {
  const [passphrase, setPassphrase] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleConfirmUninstall = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!confirmed || confirmText.trim().toUpperCase() !== "APAGAR TUDO") {
      setError('Marque a confirmação e digite "APAGAR TUDO".');
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
            Desinstalação Protegida — LockPad
          </div>
        </div>

        <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
          Existe um cofre criptografado ativo neste computador. Para impedir perda acidental ou remoção não autorizada, o LockPad só pode ser desinstalado após você digitar sua frase-chave e confirmar a exclusão dos dados.
        </div>

        {error && <div className="alert-banner">{error}</div>}

        <form onSubmit={handleConfirmUninstall} className="field-group">
          <div className="field-label">
            <Lock size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />
            Frase-chave do cofre
          </div>
          <input
            type="password"
            className="field-input"
            placeholder="Digite sua frase-chave..."
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoFocus
          />

          <div className="field-label">Confirmação obrigatória</div>
          <input
            type="text"
            className="field-input"
            placeholder='Digite "APAGAR TUDO"'
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
              Confirmo que todas as notas, imagens, vídeos e pastas criptografadas serão apagadas permanentemente junto com o aplicativo.
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
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-danger"
              style={{ flex: 1 }}
              disabled={
                busy ||
                !passphrase ||
                !confirmed ||
                confirmText.trim().toUpperCase() !== "APAGAR TUDO"
              }
            >
              <Trash2 size={14} /> Apagar e Desinstalar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
