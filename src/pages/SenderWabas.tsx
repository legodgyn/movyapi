import { useEffect, useState } from "react";
import { unwrapList } from "../lib/api";
import { labelOf } from "../lib/format";
import { senders } from "../lib/services";
import type { ApiRecord } from "../lib/types";

export function SenderWabas() {
  const [items, setItems] = useState<ApiRecord[]>([]);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");

  async function load(nextPage = page) {
    setStatus("Carregando WABAs...");
    const raw = await senders.wabas(nextPage, 50).catch(() => null);
    setItems(unwrapList<ApiRecord>(raw));
    setStatus("");
  }

  useEffect(() => {
    load(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  return (
    <main className="page grid">
      <section className="card grid">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h3>WABAs</h3>
            <p className="muted">Gerenciamento de WABAs e telefones conectados.</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="button secondary" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Anterior</button>
            <button className="button secondary" onClick={() => setPage((current) => current + 1)}>Proxima</button>
          </div>
        </div>
        {status && <p className="muted">{status}</p>}
        <div className="table-list">
          {items.map((item, index) => (
            <div className="table-row" key={String(item.id || index)}>
              <strong>{labelOf(item, "WABA")}</strong>
              <span className="muted">{String(item.status || item.business_name || item.phone_number || "-")}</span>
            </div>
          ))}
          {!items.length && <p className="muted">Nenhuma WABA retornada.</p>}
        </div>
      </section>
    </main>
  );
}
