# Scale API Rebuild

Reconstrucao inicial do painel Scale API a partir do aplicativo publicado.

## Como rodar

```bash
npm install
npm run dev
```

Crie um `.env` a partir de `.env.example` se quiser apontar para outros ambientes.

## Estado atual

- Base React/Vite.
- Login conectado ao endpoint real.
- Layout com sidebar e rotas principais.
- Clientes HTTP para API principal e gateway Infobip.
- Telas iniciais para templates, broadcast, contatos, midias, flows, analytics, admin users e campanhas.
- Mapa tecnico em `docs/recovery-map.md`.

## Proximos passos

Reconstruir tela por tela com contratos reais da API, comecando pelos modulos que mais importam para a operacao.
