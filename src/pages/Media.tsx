import { ChangeEvent, DragEvent, useEffect, useMemo, useState } from "react";
import { Check, Clipboard, Download, FileAudio, FileImage, FileVideo, Image, Trash2, Upload } from "lucide-react";
import { formatBytes, formatDate, labelOf } from "../lib/format";
import { media } from "../lib/services";
import type { MediaItem } from "../lib/types";

type LocalMediaItem = MediaItem & {
  localUrl?: string;
};

function mediaUrl(item: LocalMediaItem) {
  return item.public_url || item.url || item.localUrl || "";
}

function uploadUrl(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  for (const key of ["url", "public_url", "publicUrl", "location", "path"]) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  const nested = record.data || record.file || record.upload;
  if (nested && typeof nested === "object") return uploadUrl(nested);
  return "";
}

function mediaKind(type?: string) {
  if (type?.startsWith("image/")) return "image";
  if (type?.startsWith("video/")) return "video";
  if (type?.startsWith("audio/")) return "audio";
  return "file";
}

function MediaIcon({ type }: { type?: string }) {
  const kind = mediaKind(type);
  if (kind === "video") return <FileVideo size={22} />;
  if (kind === "audio") return <FileAudio size={22} />;
  return <FileImage size={22} />;
}

export function Media() {
  const [activeTab, setActiveTab] = useState<"upload" | "library">("upload");
  const [items, setItems] = useState<LocalMediaItem[]>([]);
  const [status, setStatus] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  const stats = useMemo(
    () => [
      { value: "16MB", label: "Limite por arquivo" },
      { value: "Auto", label: "Compressão inteligente" },
      { value: "Link", label: "Download direto" },
    ],
    [],
  );

  async function load() {
    const list = await media.normalizedList().catch(() => []);
    setItems((current) => {
      const locals = current.filter((item) => String(item.id).startsWith("local-"));
      return [...locals, ...list];
    });
  }

  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    setIsUploading(true);
    setStatus(`Enviando ${files.length} arquivo(s)...`);

    const created: LocalMediaItem[] = [];

    for (const file of files) {
      try {
        const uploaded = await media.upload(file);
        const remoteUrl = uploadUrl(uploaded);
        const saved = await media
          .save({
            name: file.name,
            type: file.type,
            size: file.size,
            url: remoteUrl,
            upload: uploaded,
          })
          .catch(() => null);

        created.push({
          id: saved && typeof saved === "object" && "id" in saved ? String((saved as { id: unknown }).id) : `local-${crypto.randomUUID()}`,
          name: file.name,
          type: file.type,
          size: file.size,
          url: remoteUrl,
          localUrl: remoteUrl || URL.createObjectURL(file),
          created_at: new Date().toISOString(),
        });
      } catch {
        created.push({
          id: `local-${crypto.randomUUID()}`,
          name: file.name,
          type: file.type,
          size: file.size,
          localUrl: URL.createObjectURL(file),
          created_at: new Date().toISOString(),
        });
      }
    }

    setItems((current) => [...created, ...current]);
    setActiveTab("library");
    setStatus(`${created.length} arquivo(s) pronto(s) na biblioteca.`);
    setIsUploading(false);
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    await uploadFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  async function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    await uploadFiles(Array.from(event.dataTransfer.files ?? []));
  }

  async function copyLink(item: LocalMediaItem) {
    const url = mediaUrl(item);
    if (!url) {
      setStatus("Este arquivo ainda não tem link direto.");
      return;
    }

    await navigator.clipboard.writeText(url);
    setStatus("Link copiado.");
  }

  async function removeItem(item: LocalMediaItem) {
    if (!String(item.id).startsWith("local-")) {
      await media.remove(item.id).catch(() => null);
    }
    if (item.localUrl?.startsWith("blob:")) URL.revokeObjectURL(item.localUrl);
    setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    setStatus("Mídia removida.");
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <main className="template-page media-page">
      <div className="template-heading">
        <div className="page-heading-icon">
          <Image size={24} />
        </div>
        <div>
          <h1>Gerenciador de Mídias</h1>
          <p>Upload e compressão inteligente de vídeos, imagens e áudios (convertidos para OGG)</p>
        </div>
      </div>

      <div className="media-tabs">
        <button className={activeTab === "upload" ? "media-tab active" : "media-tab"} onClick={() => setActiveTab("upload")}>
          Upload
        </button>
        <button className={activeTab === "library" ? "media-tab active" : "media-tab"} onClick={() => setActiveTab("library")}>
          Minhas Mídias
        </button>
      </div>

      {activeTab === "upload" ? (
        <>
          <section className="card media-upload-card">
            <h3>Enviar Mídia</h3>
            <p className="hint">
              Faça upload de vídeos, imagens ou áudios. Vídeos maiores que 16MB serão automaticamente comprimidos.
              Áudios são convertidos para formato OGG.
            </p>

            <label
              className="dropzone media-dropzone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
            >
              <input accept="image/*,video/*,audio/*" multiple onChange={handleUpload} type="file" />
              <span className="dropzone-icon">
                <Upload size={32} />
              </span>
              <strong>{isUploading ? "Enviando arquivos..." : "Arraste um arquivo ou clique para selecionar"}</strong>
              <small>Vídeos maiores que 16MB serão comprimidos. Áudios são convertidos para OGG.</small>
            </label>
          </section>

          <div className="media-stats">
            {stats.map((item) => (
              <div className="card media-stat" key={item.label}>
                <strong>{item.value}</strong>
                <p>{item.label}</p>
              </div>
            ))}
          </div>
        </>
      ) : (
        <section className="card media-library-card">
          <h3>Minhas Mídias</h3>
          <p className="hint">Seus arquivos enviados. Clique no ícone de copiar para obter o link direto.</p>

          <div className="media-list">
            {items.map((item) => {
              const url = mediaUrl(item);
              const kind = mediaKind(item.type);
              return (
                <article className="media-item" key={item.id}>
                  <div className="media-thumb">
                    {kind === "image" && url ? <img alt={labelOf(item, "Mídia")} src={url} /> : <MediaIcon type={item.type} />}
                  </div>
                  <div className="media-info">
                    <strong>{labelOf(item, "Mídia")}</strong>
                    <span>
                      {item.type || "arquivo"} · {formatBytes(item.size)} · {formatDate(item.created_at)}
                    </span>
                    {url ? <small>{url}</small> : <small>Arquivo local sem link público</small>}
                  </div>
                  <div className="media-actions">
                    <button className="icon-button" onClick={() => copyLink(item)} title="Copiar link">
                      <Clipboard size={15} />
                    </button>
                    {url ? (
                      <a className="icon-button" download={item.name || item.file_name || "midia"} href={url} title="Baixar">
                        <Download size={15} />
                      </a>
                    ) : null}
                    <button className="icon-button" onClick={() => removeItem(item)} title="Remover">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </article>
              );
            })}
            {!items.length ? (
              <div className="media-empty">
                <Check size={22} />
                <p>Nenhuma mídia enviada ainda.</p>
              </div>
            ) : null}
          </div>
        </section>
      )}

      {status ? <p className="list-status muted">{status}</p> : null}
    </main>
  );
}
