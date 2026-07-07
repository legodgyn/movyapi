import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { Check, Clipboard, Download, FileAudio, FileImage, FileVideo, Image, Trash2, Upload } from "lucide-react";
import { config } from "../lib/config";
import { formatBytes, formatDate, labelOf } from "../lib/format";
import type { MediaItem } from "../lib/types";

type LocalMediaItem = MediaItem & {
  storagePath?: string;
};

const MEDIA_LIBRARY_KEY = "movy.mediaLibrary";

function backendUrl() {
  const configured = config.mediaBackendUrl || config.localBackendUrl;
  if (/^https?:\/\//i.test(configured)) return configured.replace(/\/$/, "");
  const origin =
    typeof window !== "undefined" && window.location.origin && !window.location.origin.includes("localhost")
      ? window.location.origin
      : config.publicAppUrl;
  return `${origin.replace(/\/$/, "")}/${configured.replace(/^\/+|\/+$/g, "")}`;
}

function absoluteMediaUrl(value?: string) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/local-api/")) return `${config.publicAppUrl.replace(/\/$/, "")}${url}`;
  if (url.startsWith("/media/files/")) return `${backendUrl()}${url}`;
  if (url.startsWith("/")) return `${backendUrl()}${url}`;
  return url;
}

function mediaUrl(item: LocalMediaItem) {
  return absoluteMediaUrl(item.public_url || item.url || item.storagePath);
}

function normalizeMediaItem(item: LocalMediaItem): LocalMediaItem {
  const storagePath =
    item.storagePath ||
    String(item.url || item.public_url || "").match(/\/media\/files\/[^?#]+/)?.[0] ||
    "";
  const url = mediaUrl({ ...item, storagePath });
  return {
    ...item,
    storagePath,
    url,
    public_url: url,
  };
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

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || "");
      resolve(value.includes(",") ? value.split(",").pop() || "" : value);
    };
    reader.onerror = () => reject(reader.error || new Error("Falha ao ler arquivo."));
    reader.readAsDataURL(file);
  });
}

async function uploadToLocalBackend(file: File) {
  const response = await fetch(`${backendUrl()}/media/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      base64: await fileToBase64(file),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.message || payload.error || "Falha ao enviar midia.");
  }
  return payload as { path: string; filename: string; type: string; size: number };
}

async function readMediaLibrary() {
  try {
    const response = await fetch(`${backendUrl()}/storage/${encodeURIComponent(MEDIA_LIBRARY_KEY)}`);
    const payload = await response.json().catch(() => ({}));
    const value = Array.isArray(payload.value) ? payload.value : [];
    localStorage.setItem(MEDIA_LIBRARY_KEY, JSON.stringify(value));
    return value as LocalMediaItem[];
  } catch {
    try {
      return JSON.parse(localStorage.getItem(MEDIA_LIBRARY_KEY) || "[]") as LocalMediaItem[];
    } catch {
      return [];
    }
  }
}

async function writeMediaLibrary(value: LocalMediaItem[]) {
  localStorage.setItem(MEDIA_LIBRARY_KEY, JSON.stringify(value));
  await fetch(`${backendUrl()}/storage/${encodeURIComponent(MEDIA_LIBRARY_KEY)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  }).catch(() => null);
}

export function Media() {
  const [activeTab, setActiveTab] = useState<"upload" | "library">("upload");
  const [items, setItems] = useState<LocalMediaItem[]>([]);
  const [status, setStatus] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);
  const copyFeedbackTimeout = useRef<number | null>(null);

  const stats = useMemo(
    () => [
      { value: "32MB", label: "Limite tecnico" },
      { value: "DB", label: "Biblioteca persistente" },
      { value: "Link", label: "Download direto" },
    ],
    [],
  );

  async function load() {
    const list = await readMediaLibrary();
    const normalized = Array.isArray(list) ? list.map(normalizeMediaItem) : [];
    setItems(normalized);
    if (JSON.stringify(list) !== JSON.stringify(normalized)) {
      await writeMediaLibrary(normalized);
    }
  }

  async function persist(nextItems: LocalMediaItem[]) {
    const normalized = nextItems.map(normalizeMediaItem);
    setItems(normalized);
    await writeMediaLibrary(normalized);
  }

  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    setIsUploading(true);
    setStatus(`Enviando ${files.length} arquivo(s)...`);

    const created: LocalMediaItem[] = [];

    for (const file of files) {
      try {
        const uploaded = await uploadToLocalBackend(file);
        const remoteUrl = absoluteMediaUrl(uploaded.path);
        created.push({
          id: `media-${crypto.randomUUID()}`,
          name: file.name,
          type: uploaded.type || file.type,
          size: uploaded.size || file.size,
          url: remoteUrl,
          public_url: remoteUrl,
          storagePath: uploaded.path,
          created_at: new Date().toISOString(),
        });
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Falha ao enviar midia.");
      }
    }

    if (created.length) {
      await persist([...created, ...items]);
      setActiveTab("library");
      setStatus(`${created.length} arquivo(s) pronto(s) na biblioteca.`);
    }
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
      setStatus("Este arquivo ainda nao tem link direto.");
      return;
    }

    await navigator.clipboard.writeText(url);
    setCopiedItemId(item.id);
    setStatus("Link copiado.");
    if (copyFeedbackTimeout.current) {
      window.clearTimeout(copyFeedbackTimeout.current);
    }
    copyFeedbackTimeout.current = window.setTimeout(() => {
      setCopiedItemId(null);
      copyFeedbackTimeout.current = null;
    }, 1800);
  }

  async function removeItem(item: LocalMediaItem) {
    await persist(items.filter((candidate) => candidate.id !== item.id));
    setStatus("Midia removida.");
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimeout.current) {
        window.clearTimeout(copyFeedbackTimeout.current);
      }
    };
  }, []);

  return (
    <main className="template-page media-page">
      <div className="template-heading">
        <div className="page-heading-icon">
          <Image size={24} />
        </div>
        <div>
          <h1>Gerenciador de Midias</h1>
          <p>Envie imagens, videos e audios para usar em templates, broadcasts e fluxos.</p>
        </div>
      </div>

      <div className="media-tabs">
        <button className={activeTab === "upload" ? "media-tab active" : "media-tab"} onClick={() => setActiveTab("upload")}>
          Upload
        </button>
        <button className={activeTab === "library" ? "media-tab active" : "media-tab"} onClick={() => setActiveTab("library")}>
          Minhas Midias
        </button>
      </div>

      {activeTab === "upload" ? (
        <>
          <section className="card media-upload-card">
            <h3>Enviar Midia</h3>
            <p className="hint">
              Faca upload de videos, imagens ou audios. Os arquivos ficam salvos no banco da VPS e podem ser reutilizados depois.
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
              <small>Formatos aceitos: imagem, video e audio. Limite atual: 32MB por arquivo.</small>
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
          <h3>Minhas Midias</h3>
          <p className="hint">Seus arquivos enviados. Clique no icone de copiar para obter o link direto.</p>

          <div className="media-list">
            {items.map((item) => {
              const url = mediaUrl(item);
              const kind = mediaKind(item.type);
              return (
                <article className="media-item" key={item.id}>
                  <div className="media-thumb">
                    {kind === "image" && url ? <img alt={labelOf(item, "Midia")} src={url} /> : <MediaIcon type={item.type} />}
                  </div>
                  <div className="media-info">
                    <strong>{labelOf(item, "Midia")}</strong>
                    <span>
                      {item.type || "arquivo"} · {formatBytes(item.size)} · {formatDate(item.created_at)}
                    </span>
                    {url ? <small>{url}</small> : <small>Arquivo sem link publico</small>}
                  </div>
                  <div className="media-actions">
                    <button
                      aria-label={copiedItemId === item.id ? "Link copiado" : "Copiar link"}
                      className={copiedItemId === item.id ? "icon-button media-action-button copied" : "icon-button media-action-button"}
                      onClick={() => copyLink(item)}
                      title={copiedItemId === item.id ? "Link copiado" : "Copiar link"}
                    >
                      {copiedItemId === item.id ? <Check size={15} /> : <Clipboard size={15} />}
                      <span className="media-action-feedback" role="status">
                        Link copiado
                      </span>
                    </button>
                    {url ? (
                      <a className="icon-button media-action-button" download={item.name || item.file_name || "midia"} href={url} title="Baixar">
                        <Download size={15} />
                      </a>
                    ) : null}
                    <button className="icon-button media-action-button" onClick={() => removeItem(item)} title="Remover">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </article>
              );
            })}
            {!items.length ? (
              <div className="media-empty">
                <Check size={22} />
                <p>Nenhuma midia enviada ainda.</p>
              </div>
            ) : null}
          </div>
        </section>
      )}

      {status ? <p className="list-status muted">{status}</p> : null}
    </main>
  );
}
