# Barbera — plataforma de barbearia

Clientes criam conta, escolhem profissional, serviço, data e horário, acompanham
e cancelam reservas e assinam planos mensais. A equipe tem uma visão geral com
clientes, agenda, assinaturas, profissionais e serviços.

O planejamento completo (personas, requisitos, backlog) está em
[`docs/PRD.md`](docs/PRD.md).

## Rodar

### Com Docker

```bash
cd barbera
docker compose up --build
```

Site em `http://localhost:8080` (o nginx serve o React e repassa `/api` ao FastAPI,
então site e API ficam na mesma origem).

### Sem Docker

Precisa de um MongoDB em `localhost:27017`.

```bash
# API
cd barbera/backend
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn server:app --reload --port 8001

# site (outro terminal)
cd barbera/frontend
npm install
npm run dev        # http://localhost:5173, com /api repassado para a porta 8001
```

### Testes

```bash
cd barbera/backend
pip install -r requirements-dev.txt
pytest             # usa MongoDB em memória (mongomock), não precisa de banco rodando

cd ../frontend
npm run build
```

## Conta da equipe

Criada automaticamente na primeira subida, a partir de `ADMIN_EMAIL` e
`ADMIN_PASSWORD`:

| E-mail | Senha |
|---|---|
| `admin@barbera.local` | `Barbera123!` |

Esses valores são só para ambiente local. Em qualquer ambiente acessível pela
internet, defina outro `ADMIN_PASSWORD` e um `JWT_SECRET` longo e aleatório.
Clientes se cadastram pela própria tela de entrada.

## Arquitetura

```
barbera/
├── backend/
│   ├── server.py            FastAPI: autenticação, catálogo, horários, reservas, planos, equipe
│   ├── tests/test_api.py    testes de API (pytest + mongomock)
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.jsx          sessão, estrutura (barra lateral / barra inferior no celular) e rotas
│   │   ├── api.js           cliente HTTP (fetch com cookie) e formatação de datas e valores
│   │   ├── pages/           AuthPage, AgendaPage, BookingPage, PlansPage, AdminPage
│   │   ├── App.css          layout e componentes
│   │   └── index.css        tokens de cor, tipografia e reset
│   ├── nginx.conf           usado na imagem Docker
│   └── vite.config.js
├── docs/PRD.md
└── docker-compose.yml       mongo + backend + frontend
```

| Camada | Tecnologia |
|---|---|
| Frontend | React 19, React Router 7, Vite, lucide-react, CSS próprio responsivo |
| Backend | FastAPI, Motor (MongoDB assíncrono), PyJWT, bcrypt, Stripe SDK |
| Banco | MongoDB: coleções `users`, `professionals`, `services`, `bookings` |
| Sessão | JWT de 7 dias em cookie HTTP-only `barbera_session` (SameSite=Lax) |

### Regras de agenda

- Funcionamento de 09:00 às 19:00, com inícios a cada 30 minutos; domingo não aparece no calendário.
- Cada reserva ocupa o tempo do serviço (30, 45 ou 70 min). Um horário só aparece
  se o serviço inteiro couber antes de 19:00 sem encostar em outra reserva
  confirmada do mesmo profissional.
- Datas passadas e horários que já passaram hoje não são oferecidos (fuso `America/Sao_Paulo`).
- O servidor confere a disponibilidade de novo ao reservar (responde `409` se
  alguém pegou o horário antes) e usa nome e preço do catálogo, ignorando o que o
  navegador mandar.

## API

Todas as rotas começam com `/api`. As marcadas com 🔒 exigem sessão; 🛡️ exige conta da equipe.

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/` | Saúde; informa se o Stripe está em modo `live` ou `demo` |
| `POST` | `/auth/register` | Cria conta de cliente e já inicia a sessão |
| `POST` | `/auth/login` | Inicia a sessão |
| `POST` | `/auth/logout` | Encerra a sessão |
| `GET` | `/auth/me` 🔒 | Usuário atual (com a assinatura, se houver) |
| `GET` | `/catalog` | Profissionais e serviços |
| `GET` | `/slots?date=AAAA-MM-DD&professional_id=p1&service_id=s1` | Horários livres |
| `POST` | `/bookings` 🔒 | Cria reserva `{professional_id, service_id, date, time}` |
| `GET` | `/bookings` 🔒 | Reservas do cliente (mais recentes primeiro) |
| `PATCH` | `/bookings/{id}` 🔒 | Cancela: `{"status": "cancelled"}` (dono ou equipe) |
| `GET` | `/plans` | Planos mensais |
| `POST` | `/subscriptions/checkout?plan_id=executive` 🔒 | Abre o checkout e devolve `{url, demo}` |
| `POST` | `/stripe/webhook` | Confirma/cancela assinaturas a partir de eventos do Stripe |
| `GET` | `/admin/overview` 🛡️ | Números, agenda geral, assinaturas, profissionais e serviços |
| `POST` | `/admin/professionals` 🛡️ | `{name, specialty, initials, color}` |
| `POST` | `/admin/services` 🛡️ | `{name, duration, price, description}` |

Exemplo:

```bash
curl -c cookies.txt -X POST localhost:8001/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"João da Silva","email":"joao@example.com","password":"123456"}'

curl -b cookies.txt -X POST localhost:8001/api/bookings \
  -H 'Content-Type: application/json' \
  -d '{"professional_id":"p1","service_id":"s1","date":"2026-10-13","time":"14:00"}'
```

## Dados iniciais

| Profissional | Especialidade | id |
|---|---|---|
| Rafael Costa | Cortes precisos | `p1` |
| Caio Martins | Barba & navalha | `p2` |
| Leo Almeida | Estilo autoral | `p3` |

| Serviço | Duração | Preço | id |
|---|---|---|---|
| Corte clássico | 45 min | R$ 35 | `s1` |
| Barba completa | 30 min | R$ 25 | `s2` |
| Corte + barba | 70 min | R$ 55 | `s3` |

| Plano | Preço | Benefícios |
|---|---|---|
| Gentleman | R$ 49/mês | 2 cortes, 10% em produtos, reserva com 7 dias de antecedência |
| Executive | R$ 79/mês | cortes ilimitados, 1 barba, 15% em produtos, reserva prioritária |
| Master | R$ 119/mês | cortes e barbas ilimitados, profissional fixo, 20% em produtos, bebida da casa |

## Pagamentos (Stripe)

- **Sem `STRIPE_API_KEY`** o checkout é **demonstrativo**: nada é cobrado, a
  assinatura fica gravada com status `demo` e o navegador volta para
  `/planos?subscription=success&demo=1`, que avisa que é uma simulação.
- **Com `STRIPE_API_KEY`** é criada uma sessão real do Stripe Checkout
  (assinatura mensal em BRL). A assinatura fica `pending` até o webhook confirmar.
- **Webhook:** aponte o Stripe para `POST /api/stripe/webhook` e defina
  `STRIPE_WEBHOOK_SECRET`. `checkout.session.completed` marca como `active`;
  `customer.subscription.deleted` marca como `cancelled`. Para testar localmente:
  `stripe listen --forward-to localhost:8001/api/stripe/webhook`.

## Variáveis de ambiente (backend)

| Variável | Padrão | Uso |
|---|---|---|
| `MONGO_URL` | `mongodb://localhost:27017` | Conexão com o MongoDB |
| `DB_NAME` | `barbera` | Nome do banco |
| `JWT_SECRET` | valor de desenvolvimento | Assina o cookie de sessão. **Troque em produção** |
| `FRONTEND_URL` | `http://localhost:5173` | CORS e endereços de retorno do checkout |
| `CORS_ORIGINS` | `FRONTEND_URL` | Lista separada por vírgula, se houver mais de uma origem |
| `COOKIE_SECURE` | `false` | `true` quando servido por HTTPS |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@barbera.local` / `Barbera123!` | Conta da equipe criada na primeira subida |
| `STRIPE_API_KEY` | vazio | Liga o checkout real |
| `STRIPE_WEBHOOK_SECRET` | vazio | Liga o webhook |

No frontend, `VITE_BACKEND_URL` só é necessário se a API estiver em outra origem
(nesse caso, inclua o endereço do site em `CORS_ORIGINS` e sirva tudo por HTTPS
com `COOKIE_SECURE=true`).

## Identidade visual

Editorial, clara e com cara de clube de assinatura, longe do visual padrão de dashboard.

| Token | Cor | Uso |
|---|---|---|
| `--ink` | `#222426` | texto, cartão "próximo horário" |
| `--muted` | `#747978` | textos secundários |
| `--paper` | `#f7f8f5` | fundo |
| `--green` | `#356859` | marca, ações principais, plano em destaque |
| `--orange` | `#ef8354` | acentos, horário em destaque, item ativo do menu |
| `--yellow` | `#e0a458` | "Bem cuidado.", destaques sobre o verde |

Tipografia: **Manrope** (interface), **DM Mono** (rótulos e números técnicos) e
**Georgia** em itálico (frases editoriais e nomes dos planos).
