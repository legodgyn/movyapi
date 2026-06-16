# Scale API Recovery Map

Este documento registra o que foi inferido a partir do site publicado em
`https://app.scaleapi.com.br/`.

## Stack observada

- React 18 em SPA montada em `#root`.
- Vite em producao, com bundle `/assets/index-Dted7nT5.js`.
- CSS gerado por Tailwind, com tema dark e variaveis de design.
- Padrao visual compativel com shadcn/ui, Radix UI e Lucide.
- Estado e validacao: Zustand, Zod, React Query/TanStack Query.
- Graficos e fluxos: Recharts e React Flow.
- Arquivos: PapaParse, SheetJS/XLSX e FFmpeg WASM.
- Captcha/anti-abuso: Altcha.
- Integracoes: Meta/Facebook SDK, WhatsApp Cloud API, Infobip e Supabase.

## Ambientes publicados

- App: `https://app.scaleapi.com.br`
- API principal: `https://api.scaleapi.com.br/api/v1`
- Gateway Infobip: `https://automacoes-infobip-crack.fnyqhf.easypanel.host`
- Supabase: `https://hrnciimcoxlhnjrnfuzw.supabase.co`

## Autenticacao

- Login em `POST /auth/login`.
- Perfil em `GET /auth/me`.
- Refresh em `PUT /auth/refresh-token`.
- Token salvo em `localStorage` na chave `token`.
- Requests usam `Authorization: Bearer <access_token>`.

## Rotas de tela vistas no painel

- `/auth`
- `/`
- `/meta-templates`
- `/media`
- `/copy-creator`
- `/broadcast`
- `/contatos`
- `/cloud-templates`
- `/transmission-analytics`
- `/flows`
- `/embedded-signup`
- `/admin/users`
- `/admin/handle-manager`
- `/admin/analytics`
- `/admin/sender-registration`
- `/admin/registered-senders`
- `/transmissoes`
- `/campaigns`
- `/admin/v1/users`
- `/admin/v1/security`

## Endpoints encontrados no bundle

- `/auth/login`
- `/auth/register`
- `/auth/me`
- `/auth/refresh-token`
- `/auth/forgot-password`
- `/auth/reset-password`
- `/auth/verify-email`
- `/auth/verify-email/resend`
- `/auth/generate-api-token`
- `/templates`
- `/templates/saved`
- `/message_templates`
- `/broadcasts`
- `/contacts`
- `/import/contacts/csv`
- `/media`
- `/media/recent`
- `/analytics/transmissions`
- `/analytics/infobip`
- `/infobip/apis`
- `/infobip/apis/reorder`
- `/senders`
- `/senders/wabas`
- `/senders/phone-numbers`
- `/senders/registration/register`
- `/senders/registration/verify`
- `/senders/registration/resend`
- `/senders/token-exchange`
- `/saved-flows`
- `/qr-flows`
- `/campaigns`
- `/admin/users`
- `/admin/restrictions/apis`
- `/user-api-restrictions`
- `/user-api-restrictions/me`
- `/api/admin/queues`

## Modulos para reconstruir

1. Shell, login, cliente de API, menu e tema.
2. Criacao de templates com preview WhatsApp.
3. Broadcast/campanhas e status.
4. Contatos, tags e importacao CSV/ZIP.
5. Midias com upload, compressao e conversao.
6. Flows com editor visual.
7. Analytics com Recharts.
8. Admin de usuarios, permissoes, IPs e dominios.
9. Remetentes, WABAs e embedded signup da Meta.

## Observacoes

- O HTML publicado tem `meta author="Lovable"`, indicando origem ou prototipacao no Lovable.
- Nao havia source maps publicados.
- Foi observado erro no console em uma rota admin: `TypeError: l.filter is not a function`.
