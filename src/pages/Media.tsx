import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Clipboard, Download, FileAudio, FileImage, FileVideo, Image, Trash2, Upload } from "lucide-react";
import { config } from "../lib/config";
import { formatBytes, formatDate, labelOf } from "../lib/format";
import { media as mediaService } from "../lib/services";
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

function mediaItemKey(item: LocalMediaItem, index: number) {
  return String(mediaUrl(item) || item.public_url || item.url || item.storagePath || item.id || `${item.name || item.file_name || "midia"}-${item.size || 0}-${item.created_at || index}`);
}

function mergeMediaItems(...groups: LocalMediaItem[][]) {
  const byKey = new Map<string, LocalMediaItem>();
  groups.flat().map(normalizeMediaItem).forEach((item, index) => {
    const key = mediaItemKey(item, index);
    if (!key) return;
    byKey.set(key, { ...byKey.get(key), ...item });
  });
  return Array.from(byKey.values()).sort((left, right) => {
    const leftDate = new Date(String(left.created_at || 0)).getTime() || 0;
    const rightDate = new Date(String(right.created_at || 0)).getTime() || 0;
    return rightDate - leftDate;
  });
}

function readLocalMediaLibrary() {
  try {
    return JSON.parse(localStorage.getItem(MEDIA_LIBRARY_KEY) || "[]") as LocalMediaItem[];
  } catch {
    return [];
  }
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
  const sources: LocalMediaItem[][] = [];

  try {
    const response = await fetch(`${backendUrl()}/media/library`);
    const payload = await response.json().catch(() => ({}));
    const value = Array.isArray(payload.items) ? payload.items : Array.isArray(payload.media) ? payload.media : [];
    sources.push(value as LocalMediaItem[]);
  } catch {
    // Older local APIs may not expose the physical media library endpoint.
  }

  await mediaService.normalizedList()
    .then((value) => {
      if (Array.isArray(value)) sources.push(value as LocalMediaItem[]);
    })
    .catch(() => null);

  try {
    const response = await fetch(`${backendUrl()}/storage/${encodeURIComponent(MEDIA_LIBRARY_KEY)}`);
    const payload = await response.json().catch(() => ({}));
    const value = Array.isArray(payload.value) ? payload.value : [];
    sources.push(value as LocalMediaItem[]);
  } catch {
    // Local API can be unavailable in development.
  }

  const localItems = readLocalMediaLibrary();
  if (localItems.length) sources.push(localItems);

  const merged = mergeMediaItems(...sources);
  if (merged.length || localItems.length) {
    await writeMediaLibrary(merged);
  }
  return merged;
}

async function writeMediaLibrary(value: LocalMediaItem[]) {
  const normalized = mergeMediaItems(value);
  localStorage.setItem(MEDIA_LIBRARY_KEY, JSON.stringify(normalized));
  await fetch(`${backendUrl()}/storage/${encodeURIComponent(MEDIA_LIBRARY_KEY)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: normalized }),
  }).catch(() => null);
}

export function Media() {
  const [activeTab, setActiveTab] = useState<"upload" | "library">("upload");
  const [items, setItems] = useState<LocalMediaItem[]>([]);
  const [status, setStatus] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);
  const [libraryPage, setLibraryPage] = useState(1);
  const [libraryPageSize, setLibraryPageSize] = useState(10);
  const copyFeedbackTimeout = useRef<number | null>(null);

  const stats = useMemo(
    () => [
      { value: "32MB", label: "Limite tecnico" },
      { value: "DB", label: "Biblioteca persistente" },
      { value: "Link", label: "Download direto" },
    ],
    [],
  );

  const totalLibraryPages = Math.max(1, Math.ceil(items.length / libraryPageSize));
  const visibleLibraryItems = items.slice((libraryPage - 1) * libraryPageSize, libraryPage * libraryPageSize);
  const libraryStart = items.length ? (libraryPage - 1) * libraryPageSize + 1 : 0;
  const libraryEnd = Math.min(items.length, libraryPage * libraryPageSize);

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
    setLibraryPage((current) => Math.min(Math.max(1, current), totalLibraryPages));
  }, [totalLibraryPages]);

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
          Minhas Midias {items.length ? <span>{items.length}</span> : null}
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
          <div className="media-library-head">
            <div>
              <h3>Minhas Midias</h3>
              <p className="hint">Seus arquivos enviados. Clique no icone de copiar para obter o link direto.</p>
            </div>
            <div className="media-pagination-controls">
              <span>{items.length ? `${libraryStart}-${libraryEnd} de ${items.length}` : "0 midias"}</span>
              <select
                className="input media-page-size"
                onChange={(event) => {
                  setLibraryPageSize(Number(event.target.value));
                  setLibraryPage(1);
                }}
                value={libraryPageSize}
              >
                <option value={10}>10 por pagina</option>
                <option value={20}>20 por pagina</option>
                <option value={50}>50 por pagina</option>
              </select>
            </div>
          </div>

          <div className="media-list">
            {visibleLibraryItems.map((item) => {
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

          {items.length > libraryPageSize ? (
            <div className="media-pagination">
              <button
                className="button secondary compact"
                disabled={libraryPage <= 1}
                onClick={() => setLibraryPage((page) => Math.max(1, page - 1))}
                type="button"
              >
                <ChevronLeft size={15} /> Anterior
              </button>
              <strong>Pagina {libraryPage} de {totalLibraryPages}</strong>
              <button
                className="button secondary compact"
                disabled={libraryPage >= totalLibraryPages}
                onClick={() => setLibraryPage((page) => Math.min(totalLibraryPages, page + 1))}
                type="button"
              >
                Proxima <ChevronRight size={15} />
              </button>
            </div>
          ) : null}
        </section>
      )}

      {status ? <p className="list-status muted">{status}</p> : null}
    </main>
  );
}
