import { useState } from "react";
import { Facebook, KeyRound, Send, ShieldCheck } from "lucide-react";
import { senders } from "../lib/services";

export function EmbeddedSignup() {
  const [code, setCode] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [phoneId, setPhoneId] = useState("");
  const [status, setStatus] = useState("");

  async function exchange() {
    setStatus("Enviando dados do signup...");
    try {
      await senders.verify({
        code,
        waba_id: wabaId,
        phone_number_id: phoneId,
      });
      setStatus("Dados enviados para verificacao.");
    } catch {
      setStatus("Nao foi possivel verificar o signup agora.");
    }
  }

  return (
    <main className="page grid">
      <div className="grid cols-3">
        {[
          ["Conectar Meta", "Receba o codigo do embedded signup.", Facebook],
          ["Trocar token", "Envie o codigo para a API.", KeyRound],
          ["Ativar remetente", "Confirme WABA e telefone.", ShieldCheck],
        ].map(([title, text, Icon]) => (
          <section className="card" key={String(title)}>
            <Icon size={26} />
            <h3>{String(title)}</h3>
            <p className="muted">{String(text)}</p>
          </section>
        ))}
      </div>

      <section className="card grid">
        <h3>Embedded Signup</h3>
        <p className="muted">
          Reconstrucao do fluxo para capturar o codigo retornado pelo Meta Embedded Signup e
          enviar para os endpoints de remetentes.
        </p>
        <div className="grid cols-3">
          <input className="input" placeholder="Codigo retornado pela Meta" value={code} onChange={(event) => setCode(event.target.value)} />
          <input className="input" placeholder="WABA ID" value={wabaId} onChange={(event) => setWabaId(event.target.value)} />
          <input className="input" placeholder="Phone Number ID" value={phoneId} onChange={(event) => setPhoneId(event.target.value)} />
        </div>
        <button className="button" onClick={exchange}>
          <Send size={16} /> Verificar signup
        </button>
        {status && <p className="muted">{status}</p>}
      </section>
    </main>
  );
}
