import { useEffect, useState } from "react";
import { labelOf } from "../lib/format";
import { savedTemplates } from "../lib/services";
import type { SavedTemplate } from "../lib/types";

export function CloudTemplates() {
  const [items, setItems] = useState<SavedTemplate[]>([]);
  const [query, setQuery] = useState("");

  async function load() {
    setItems(await savedTemplates.normalizedList().catch(() => []));
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = items.filter((item) => labelOf(item).toLowerCase().includes(query.toLowerCase()));

  return (
    <main className="page grid">
      <section className="card grid">
        <h3>Templates Cloud</h3>
        <input className="input" placeholder="Buscar template..." value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="table-list">
          {filtered.map((item) => (
            <div className="table-row" key={item.id}>
              <strong>{labelOf(item)}</strong>
              <span className="muted">{item.media_type || "sem mídia"} · {item.language || "pt_PT"}</span>
            </div>
          ))}
          {!filtered.length && <p className="muted">Nenhum template retornado.</p>}
        </div>
      </section>
    </main>
  );
}
