import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { Check, Contact, Search, Trash2, Upload, Users } from "lucide-react";
import * as XLSX from "xlsx";
import { formatDate, labelOf } from "../lib/format";
import { contacts } from "../lib/services";
import { unwrapList } from "../lib/api";
import type { ContactItem, ContactTag } from "../lib/types";

const LOCAL_CONTACTS_KEY = "scaleapi.localContacts";

type LocalContactsStore = Record<string, { tag: ContactTag; contacts: ContactItem[] }>;

function contactName(contact: ContactItem) {
  return contact.name || contact.nome || "Sem nome";
}

function contactPhone(contact: ContactItem) {
  return contact.phone || contact.telefone || contact.whatsapp || "";
}

function normalizeHeader(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function readLocalStore(): LocalContactsStore {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_CONTACTS_KEY) || "{}") as LocalContactsStore;
  } catch {
    return {};
  }
}

function writeLocalStore(store: LocalContactsStore) {
  localStorage.setItem(LOCAL_CONTACTS_KEY, JSON.stringify(store));
}

function localTags() {
  return Object.values(readLocalStore()).map((entry) => entry.tag);
}

function findColumn(row: Record<string, unknown>, hints: string[]) {
  return Object.keys(row).find((key) => {
    const normalized = normalizeHeader(key);
    return hints.some((hint) => normalized.includes(normalizeHeader(hint)));
  });
}

async function importCsvLocally(file: File) {
  if (!/\.csv$/i.test(file.name)) {
    throw new Error("local-import-only-csv");
  }

  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const store = readLocalStore();
  let totalContacts = 0;

  rows.forEach((row, index) => {
    const tagColumn = findColumn(row, ["etiqueta", "tag", "lista"]);
    const phoneColumn = findColumn(row, ["telefone", "phone", "whatsapp", "celular", "numero", "número"]);
    const nameColumn = findColumn(row, ["nome", "name", "cliente", "lead"]);
    const emailColumn = findColumn(row, ["email", "e-mail"]);
    const tagName = String((tagColumn ? row[tagColumn] : "") || "Importados").trim();
    const phone = String((phoneColumn ? row[phoneColumn] : "") || "").trim();
    if (!phone) return;

    const tagId = `local-${tagName}`;
    if (!store[tagId]) {
      store[tagId] = {
        tag: {
          id: tagId,
          name: tagName,
          contacts_count: 0,
        },
        contacts: [],
      };
    }

    store[tagId].contacts.push({
      id: `${tagId}-${index}-${phone}`,
      name: nameColumn ? String(row[nameColumn] || "") : undefined,
      phone,
      email: emailColumn ? String(row[emailColumn] || "") : undefined,
      created_at: new Date().toISOString(),
    });
    store[tagId].tag.contacts_count = store[tagId].contacts.length;
    totalContacts += 1;
  });

  writeLocalStore(store);
  return { tags: localTags().length, contacts: totalContacts };
}

export function Contacts() {
  const [tags, setTags] = useState<ContactTag[]>([]);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [activeTag, setActiveTag] = useState<ContactTag | null>(null);
  const [tagContacts, setTagContacts] = useState<ContactItem[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [isLoadingTags, setIsLoadingTags] = useState(false);
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);

  const filteredTags = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return tags;
    return tags.filter((tag) => labelOf(tag, "Tag").toLowerCase().includes(search));
  }, [query, tags]);

  async function load(search = query) {
    setIsLoadingTags(true);
    const remoteList = await contacts.normalizedTags(search).catch(() => []);
    const searchLower = search.trim().toLowerCase();
    const localList = localTags().filter((tag) => !searchLower || labelOf(tag, "Tag").toLowerCase().includes(searchLower));
    const merged = [...localList, ...remoteList.filter((tag) => !localList.some((localTag) => localTag.id === tag.id))];
    setTags(merged);
    setIsLoadingTags(false);
  }

  async function openTag(tag: ContactTag) {
    setActiveTag(tag);
    setIsLoadingContacts(true);
    setStatus(`Carregando contatos de ${labelOf(tag, "Tag")}...`);
    if (tag.id.startsWith("local-")) {
      const entry = readLocalStore()[tag.id];
      setTagContacts(entry?.contacts ?? []);
      setStatus("");
      setIsLoadingContacts(false);
      return;
    }

    try {
      const payload = await contacts.tagContacts(tag.id, 100, 0);
      setTagContacts(unwrapList<ContactItem>(payload));
      setStatus("");
    } catch {
      setTagContacts([]);
      setStatus("Não foi possível carregar os contatos desta tag.");
    } finally {
      setIsLoadingContacts(false);
    }
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setStatus("Importando contatos...");
    try {
      await contacts.importCsv(file);
      setStatus("Importação enviada.");
      await load("");
    } catch {
      try {
        const result = await importCsvLocally(file);
        setStatus(`API indisponível. Importei localmente ${result.contacts} contato(s) em ${result.tags} tag(s).`);
        await load("");
      } catch {
        setStatus("Falha ao importar arquivo. O fallback local aceita CSV com colunas telefone e etiqueta.");
      }
    } finally {
      event.target.value = "";
    }
  }

  function toggleTag(tagId: string) {
    setSelectedTags((current) => {
      const next = new Set(current);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  function toggleAll() {
    setSelectedTags((current) => {
      if (current.size === filteredTags.length) return new Set();
      return new Set(filteredTags.map((tag) => tag.id));
    });
  }

  async function deleteSelected() {
    const ids = Array.from(selectedTags);
    if (!ids.length) return;

    setStatus(`Excluindo ${ids.length} tag(s)...`);
    try {
      const remoteIds = ids.filter((id) => !id.startsWith("local-"));
      const localIds = ids.filter((id) => id.startsWith("local-"));
      if (remoteIds.length) await contacts.deleteTags(remoteIds);
      if (localIds.length) {
        const store = readLocalStore();
        localIds.forEach((id) => delete store[id]);
        writeLocalStore(store);
      }
      setTags((current) => current.filter((tag) => !selectedTags.has(tag.id)));
      setSelectedTags(new Set());
      if (activeTag && selectedTags.has(activeTag.id)) {
        setActiveTag(null);
        setTagContacts([]);
      }
      setStatus("Tags excluídas.");
    } catch {
      setStatus("Não foi possível excluir as tags selecionadas.");
    }
  }

  useEffect(() => {
    load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="template-page contacts-page">
      <div className="template-heading">
        <div className="page-heading-icon">
          <Contact size={24} />
        </div>
        <div>
          <h1>Contatos</h1>
          <p>Importe, visualize e gerencie contatos e tags</p>
        </div>
      </div>

      <div className="contacts-layout">
        <section className="card contacts-import-card">
          <h3>Importar Contatos</h3>
          <p className="hint">Importe arquivos CSV ou ZIP para criar tags e contatos.</p>
          <label className="button file-button">
            <Upload size={17} />
            Selecionar CSV ou ZIP
            <input hidden type="file" accept=".csv,.zip" onChange={handleFile} />
          </label>
        </section>

        <section className="card contacts-tags-card">
          <div className="contacts-card-header">
            <h3>
              Tags <span>{tags.length}</span>
            </h3>
            <div className="button-row">
              <button className="button secondary compact" disabled={!filteredTags.length} onClick={toggleAll}>
                Selecionar todas
              </button>
              <button className="icon-button danger" disabled={!selectedTags.size} onClick={deleteSelected} title="Excluir selecionadas">
                <Trash2 size={15} />
              </button>
            </div>
          </div>

          <label className="search-field">
            <Search size={16} />
            <input
              placeholder="Buscar tags..."
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                load(event.target.value);
              }}
            />
          </label>

          <div className="contacts-tag-list">
            {filteredTags.map((tag) => {
              const selected = selectedTags.has(tag.id);
              return (
                <div className={activeTag?.id === tag.id ? "contact-tag-row active" : "contact-tag-row"} key={tag.id}>
                  <label className="mini-check">
                    <input checked={selected} onChange={() => toggleTag(tag.id)} type="checkbox" />
                    <span>{selected ? <Check size={12} /> : null}</span>
                  </label>
                  <button onClick={() => openTag(tag)} type="button">
                    <strong>{labelOf(tag, "Tag")}</strong>
                    <small>{tag.contacts_count ?? tag.count ?? 0} contatos</small>
                  </button>
                </div>
              );
            })}
            {!filteredTags.length ? <p className="muted">{isLoadingTags ? "Carregando tags..." : "Nenhuma tag encontrada."}</p> : null}
          </div>
        </section>

        <section className="card contacts-view-card">
          <div className="contacts-card-header">
            <h3>Contatos</h3>
            {activeTag ? <span className="muted">{labelOf(activeTag, "Tag")}</span> : null}
          </div>

          {!activeTag ? (
            <div className="contacts-empty">
              <Users size={26} />
              <p>Selecione uma tag para ver os contatos</p>
            </div>
          ) : (
            <div className="contacts-list">
              {tagContacts.map((contact, index) => (
                <div className="contact-row" key={contact.id || `${contactPhone(contact)}-${index}`}>
                  <div>
                    <strong>{contactName(contact)}</strong>
                    <span>{contactPhone(contact) || "Sem telefone"}</span>
                  </div>
                  <small>{contact.email || formatDate(contact.created_at)}</small>
                </div>
              ))}
              {!tagContacts.length ? (
                <div className="contacts-empty">
                  <Users size={26} />
                  <p>{isLoadingContacts ? "Carregando contatos..." : "Nenhum contato encontrado nesta tag."}</p>
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>

      {status ? <p className="list-status muted">{status}</p> : null}
    </main>
  );
}
