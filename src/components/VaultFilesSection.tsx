import React, { useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  ChevronRight,
  Download,
  FileText,
  Film,
  Folder,
  FolderPlus,
  Image as ImageIcon,
  Music,
  Shield,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { api, formatBytes, vaultBlobUrl } from "../api";
import type { VaultFile, VaultFolder, VaultManifest } from "../types";

interface VaultFilesSectionProps {
  manifest: VaultManifest;
  onManifestUpdate: (next: VaultManifest) => void;
  onStatusMessage: (msg: string, isError?: boolean) => void;
}

export const VaultFilesSection: React.FC<VaultFilesSectionProps> = ({
  manifest,
  onManifestUpdate,
  onStatusMessage,
}) => {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewFile, setPreviewFile] = useState<VaultFile | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent(async (event) => {
        if (event.payload.type === "over" || event.payload.type === "enter") {
          setDragOver(true);
        } else if (event.payload.type === "leave") {
          setDragOver(false);
        } else if (event.payload.type === "drop") {
          setDragOver(false);
          const paths = event.payload.paths;
          if (paths && paths.length > 0) {
            setBusy(true);
            try {
              const updated = await api.importVaultPaths(paths, currentFolderId);
              onManifestUpdate(updated);
              onStatusMessage(
                `${paths.length} item(ns) criptografado(s) e salvo(s) no cofre.`
              );
            } catch (err) {
              onStatusMessage(String(err), true);
            } finally {
              setBusy(false);
            }
          }
        }
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      if (unlisten) unlisten();
    };
  }, [currentFolderId, onManifestUpdate, onStatusMessage]);

  const breadcrumbs = useMemo(() => {
    const chain: VaultFolder[] = [];
    let cursor = currentFolderId;
    while (cursor) {
      const found = manifest.folders.find((f) => f.id === cursor);
      if (!found) break;
      chain.unshift(found);
      cursor = found.parent_id;
    }
    return chain;
  }, [manifest.folders, currentFolderId]);

  const childFolders = useMemo(
    () => manifest.folders.filter((f) => f.parent_id === currentFolderId),
    [manifest.folders, currentFolderId]
  );

  const childFiles = useMemo(
    () => manifest.files.filter((f) => f.folder_id === currentFolderId),
    [manifest.files, currentFolderId]
  );

  const handlePickFiles = async () => {
    const selected = await openDialog({
      multiple: true,
      title: "Selecionar imagens, vídeos ou arquivos para criptografar",
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    setBusy(true);
    try {
      const updated = await api.importVaultPaths(paths, currentFolderId);
      onManifestUpdate(updated);
      onStatusMessage(`${paths.length} arquivo(s) criptografado(s) com XChaCha20-Poly1305.`);
    } catch (err) {
      onStatusMessage(String(err), true);
    } finally {
      setBusy(false);
    }
  };

  const handlePickFolder = async () => {
    const selected = await openDialog({
      directory: true,
      multiple: true,
      title: "Selecionar pasta inteira para criptografar no cofre",
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    setBusy(true);
    try {
      const updated = await api.importVaultPaths(paths, currentFolderId);
      onManifestUpdate(updated);
      onStatusMessage("Pasta e subarquivos criptografados com segurança no cofre.");
    } catch (err) {
      onStatusMessage(String(err), true);
    } finally {
      setBusy(false);
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      const updated = await api.createVaultFolder(currentFolderId, newFolderName);
      onManifestUpdate(updated);
      setNewFolderName("");
      setCreatingFolder(false);
    } catch (err) {
      onStatusMessage(String(err), true);
    }
  };

  const handleExportFile = async (file: VaultFile, e: React.MouseEvent) => {
    e.stopPropagation();
    const dest = await openDialog({
      directory: true,
      title: `Escolher pasta de destino para "${file.name}"`,
    });
    if (!dest || Array.isArray(dest)) return;
    try {
      const outPath = await api.exportVaultFile(file.id, dest);
      onStatusMessage(`Exportado para: ${outPath}`);
    } catch (err) {
      onStatusMessage(String(err), true);
    }
  };

  const handleExportFolder = async (folder: VaultFolder, e: React.MouseEvent) => {
    e.stopPropagation();
    const dest = await openDialog({
      directory: true,
      title: `Exportar pasta "${folder.name}" para...`,
    });
    if (!dest || Array.isArray(dest)) return;
    try {
      const outPath = await api.exportVaultFolder(folder.id, dest);
      onStatusMessage(`Pasta exportada para: ${outPath}`);
    } catch (err) {
      onStatusMessage(String(err), true);
    }
  };

  const handleDeleteFile = async (file: VaultFile, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const updated = await api.deleteVaultFile(file.id);
      onManifestUpdate(updated);
      if (previewFile?.id === file.id) setPreviewFile(null);
      onStatusMessage(`"${file.name}" sobrescrito e apagado permanentemente.`);
    } catch (err) {
      onStatusMessage(String(err), true);
    }
  };

  const handleDeleteFolder = async (folder: VaultFolder, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const updated = await api.deleteVaultFolder(folder.id);
      onManifestUpdate(updated);
      onStatusMessage(`Pasta "${folder.name}" e conteúdo destruídos do cofre.`);
    } catch (err) {
      onStatusMessage(String(err), true);
    }
  };

  return (
    <div className={`vault-files-panel ${dragOver ? "drag-over" : ""}`}>
      <div className="note-header" style={{ justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700 }}>
          <Shield size={14} style={{ color: "var(--vault-accent)" }} />
          Arquivos, Mídia & Pastas Criptografadas
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            className="mini-btn"
            disabled={busy}
            onClick={() => setCreatingFolder((v) => !v)}
            title="Nova pasta no cofre"
          >
            <FolderPlus size={13} /> Pasta
          </button>
          <button
            className="mini-btn"
            disabled={busy}
            onClick={handlePickFiles}
            title="Adicionar imagens, vídeos ou arquivos"
          >
            <Upload size={13} /> Arquivos
          </button>
          <button
            className="mini-btn"
            disabled={busy}
            onClick={handlePickFolder}
            title="Importar pasta inteira do PC"
          >
            <Folder size={13} /> Importar Pasta
          </button>
        </div>
      </div>

      <div className="vault-breadcrumbs">
        <button className="crumb-btn" onClick={() => setCurrentFolderId(null)}>
          Cofre Raiz
        </button>
        {breadcrumbs.map((b) => (
          <React.Fragment key={b.id}>
            <ChevronRight size={12} />
            <button className="crumb-btn" onClick={() => setCurrentFolderId(b.id)}>
              {b.name}
            </button>
          </React.Fragment>
        ))}
      </div>

      {creatingFolder && (
        <form onSubmit={handleCreateFolder} style={{ display: "flex", gap: 6 }}>
          <input
            className="field-input"
            placeholder="Nome da nova pasta..."
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            autoFocus
          />
          <button type="submit" className="btn btn-primary">
            Criar
          </button>
        </form>
      )}

      {busy && (
        <div style={{ fontSize: 12, color: "var(--vault-accent)" }}>
          Criptografando em blocos XChaCha20-Poly1305...
        </div>
      )}

      {childFolders.length === 0 && childFiles.length === 0 ? (
        <div
          style={{
            padding: "18px 10px",
            textAlign: "center",
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          Arraste imagens, vídeos, documentos ou pastas inteiras aqui dentro.
          <br />
          Nenhum arquivo temporário descriptografado é gravado no disco.
        </div>
      ) : (
        <div className="vault-grid">
          {childFolders.map((folder) => (
            <div
              key={folder.id}
              className="vault-item"
              onClick={() => setCurrentFolderId(folder.id)}
            >
              <div className="vault-thumb">
                <Folder size={28} />
              </div>
              <div className="vault-item-name" title={folder.name}>
                {folder.name}
              </div>
              <div className="vault-item-meta">
                <span>Pasta</span>
                <div className="vault-item-actions">
                  <button
                    className="mini-btn"
                    title="Exportar pasta"
                    onClick={(e) => handleExportFolder(folder, e)}
                  >
                    <Download size={12} />
                  </button>
                  <button
                    className="mini-btn"
                    title="Destruir pasta"
                    onClick={(e) => handleDeleteFolder(folder, e)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {childFiles.map((file) => (
            <div
              key={file.id}
              className="vault-item"
              onClick={() => setPreviewFile(file)}
            >
              <div className="vault-thumb">
                {file.kind === "image" ? (
                  <img src={vaultBlobUrl(file.id)} alt={file.name} loading="lazy" />
                ) : file.kind === "video" ? (
                  <Film size={28} />
                ) : file.kind === "audio" ? (
                  <Music size={28} />
                ) : file.kind === "document" ? (
                  <FileText size={28} />
                ) : (
                  <ImageIcon size={28} />
                )}
              </div>
              <div className="vault-item-name" title={file.name}>
                {file.name}
              </div>
              <div className="vault-item-meta">
                <span>{formatBytes(file.size_bytes)}</span>
                <div className="vault-item-actions">
                  <button
                    className="mini-btn"
                    title="Exportar arquivo"
                    onClick={(e) => handleExportFile(file, e)}
                  >
                    <Download size={12} />
                  </button>
                  <button
                    className="mini-btn"
                    title="Destruir arquivo"
                    onClick={(e) => handleDeleteFile(file, e)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {previewFile && (
        <div className="modal-backdrop" onClick={() => setPreviewFile(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title" style={{ fontSize: 13.5, wordBreak: "break-all" }}>
                <Shield size={15} style={{ color: "var(--vault-accent)" }} />
                {previewFile.name}
              </div>
              <button className="icon-btn" onClick={() => setPreviewFile(null)}>
                <X size={16} />
              </button>
            </div>

            {previewFile.kind === "image" && (
              <img
                className="lightbox-media"
                src={vaultBlobUrl(previewFile.id)}
                alt={previewFile.name}
              />
            )}

            {previewFile.kind === "video" && (
              <video
                className="lightbox-media"
                controls
                autoPlay
                src={vaultBlobUrl(previewFile.id)}
              />
            )}

            {previewFile.kind === "audio" && (
              <audio
                controls
                autoPlay
                style={{ width: "100%" }}
                src={vaultBlobUrl(previewFile.id)}
              />
            )}

            {previewFile.kind !== "image" &&
              previewFile.kind !== "video" &&
              previewFile.kind !== "audio" && (
                <div style={{ fontSize: 12.5, color: "var(--text-secondary)", padding: "12px 0" }}>
                  Arquivo criptografado ({formatBytes(previewFile.size_bytes)}).
                  Use <strong>Exportar</strong> caso queira salvá-lo descriptografado em uma pasta.
                </div>
              )}

            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <button
                className="btn btn-danger"
                onClick={(e) => handleDeleteFile(previewFile, e)}
              >
                <Trash2 size={14} /> Destruir
              </button>
              <button
                className="btn btn-primary"
                onClick={(e) => handleExportFile(previewFile, e)}
              >
                <Download size={14} /> Exportar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
