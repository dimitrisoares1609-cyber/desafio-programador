# Barbera — plataforma de barbearia

Clientes criam conta, escolhem profissional, serviço, data e horário, acompanham,
remarcam e cancelam reservas, recuperam a senha por e-mail e assinam planos
mensais. A equipe tem uma visão geral com clientes, agenda e assinaturas, edita e
desativa profissionais e serviços e define o horário de funcionamento, folgas e
feriados.

O planejamento completo (personas, requisitos, backlog) está em
[`docs/PRD.md`](docs/PRD.md).

## Rodar

### Com Docker

```bash
cd barbera
docker compose up --build
```

Site em `http://localhost:8080`. A imagem é uma só (`barbera/Dockerfile`): o build
do React vai para dentro da API, que serve o site e o `/api` na mesma origem.

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

## Publicar (Render + MongoDB Atlas)

O arquivo [`render.yaml`](render.yaml) descreve o serviço; o banco fica no MongoDB
Atlas (o plano gratuito M0 basta para começar).

1. **Banco:** crie um cluster no [MongoDB Atlas](https://www.mongodb.com/atlas), um
   usuário de banco e, em *Network Access*, libere `0.0.0.0/0` (o Render não tem IP
   fixo no plano gratuito). Copie a string de conexão `mongodb+srv://...`.
2. **Serviço:** no Render, *New → Blueprint*, escolha este repositório e informe o
   caminho `barbera/render.yaml` (o `render.yaml` da raiz é de outro projeto).
3. **Variáveis pedidas pelo Render:**
   - `MONGO_URL`: a string do Atlas;
   - `ADMIN_EMAIL` e `ADMIN_PASSWORD`: a conta da equipe (senha forte);
   - `SMTP_*`: o servidor de e-mail para o "esqueci a senha" (Gmail com senha de
     app, Brevo, SendGrid etc.). Sem SMTP o link vai só para o log do servidor;
   - `STRIPE_*`: opcional; sem elas os planos ficam em modo demonstrativo.

   `JWT_SECRET` é gerado pelo próprio Render. O endereço público
   (`https://barbera-xxxx.onrender.com`) é lido de `RENDER_EXTERNAL_URL`.
4. Depois do primeiro deploy, se usar Stripe, cadastre o webhook
   `https://SEU-ENDERECO/api/stripe/webhook`.

Com `COOKIE_SECURE=true` (já definido no blueprint) a API **se recusa a subir** se
`JWT_SECRET` ou `ADMIN_PASSWORD` estiverem com os valores de desenvolvimento.

No plano gratuito do Render o serviço "dorme" depois de 15 minutos sem acesso e
leva cerca de 1 minuto para acordar na próxima visita.

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
│   │                        (e serve o build do site quando ele está em static/)
│   ├── tests/test_api.py    testes de API (pytest + mongomock)
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.jsx          sessão, estrutura (barra lateral / barra inferior no celular) e rotas
│   │   ├── api.js           cliente HTTP (fetch com cookie) e formatação de datas e valores
│   │   ├── pages/           AuthPage, ResetPasswordPage, AgendaPage, BookingPage, PlansPage, AdminPage
│   │   ├── App.css          layout e componentes
│   │   └── index.css        tokens de cor, tipografia e reset
│   └── vite.config.js
├── docs/PRD.md
├── Dockerfile               imagem única (build do React + API)
├── docker-compose.yml       mongo + app
└── render.yaml              blueprint do Render
```

| Camada | Tecnologia |
|---|---|
| Frontend | React 19, React Router 7, Vite, lucide-react, CSS próprio responsivo |
| Backend | FastAPI, Motor (MongoDB assíncrono), PyJWT, bcrypt, Stripe SDK |
| Banco | MongoDB: coleções `users`, `professionals`, `services`, `bookings`, `slot_locks`, `login_failures`, `password_resets`, `settings` |
| Sessão | JWT de 7 dias em cookie HTTP-only `barbera_session` (SameSite=Lax) |

### Regras de agenda

- O horário de funcionamento é definido pela equipe para cada dia da semana (em
  horas cheias ou meias), além de datas fechadas (folgas e feriados). O padrão é
  segunda a sábado, das 09:00 às 19:00. Dias fechados não aparecem no calendário.
- Os inícios são a cada 30 minutos. Cada reserva ocupa o tempo do serviço; um
  horário só aparece se o serviço inteiro couber antes do fechamento sem encostar
  em outra reserva confirmada do mesmo profissional.
- Mudar o horário não mexe nas reservas já feitas.
- **Remarcar** mantém profissional e serviço e muda data e horário; o horário
  atual da própria reserva conta como livre (dá para empurrar 30 min para frente).
- Profissionais e serviços **desativados** somem das opções de reserva; reservas
  já feitas continuam valendo, com o nome e o preço da época. Mudar preço ou
  duração de um serviço vale para as próximas reservas.
- Datas passadas e horários que já passaram hoje não são oferecidos (fuso `America/Sao_Paulo`).
- O servidor confere a disponibilidade de novo ao reservar (responde `409` se
  alguém pegou o horário antes) e usa nome e preço do catálogo, ignorando o que o
  navegador mandar.
- Cada reserva grava os blocos de 30 min que ocupa em `slot_locks`, que tem
  índice único por profissional + data + bloco. Assim, duas reservas que chegam
  ao mesmo tempo no mesmo horário não passam as duas: o banco recusa a segunda.
  Cancelar libera os blocos.

### Limite de tentativas de login

Senhas erradas ficam registradas em `login_failures` por 15 minutos (índice TTL).
Dentro dessa janela, o login responde `429` com `Retry-After` a partir de:

- **5 erros** para o mesmo e-mail vindo do mesmo IP;
- **20 erros** do mesmo IP, em qualquer e-mail;
- **10 erros** para o mesmo e-mail, de qualquer IP (segura quem troca de IP).

Um login certo zera o contador daquele e-mail naquele IP.

Atrás de proxy (Render), o IP do visitante sai do `X-Forwarded-For`, mas só das
entradas acrescentadas pelos proxies confiáveis (`TRUSTED_PROXY_HOPS`, contadas do
fim): o começo do cabeçalho o próprio visitante pode inventar.

### Esqueci a senha

`POST /auth/forgot-password` responde sempre a mesma mensagem, exista ou não a
conta. Se existir, envia por e-mail um link `/redefinir-senha?token=...` que vale
por 1 hora e uma única vez (no banco fica só o hash do token; no máximo 3 pedidos
por hora por conta). Ao criar a nova senha, a pessoa já entra e todas as outras
sessões dela são encerradas.

## API

Todas as rotas começam com `/api`. As marcadas com 🔒 exigem sessão; 🛡️ exige conta da equipe.

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/` | Saúde; informa se o Stripe está em modo `live` ou `demo` |
| `POST` | `/auth/register` | Cria conta de cliente e já inicia a sessão |
| `POST` | `/auth/login` | Inicia a sessão |
| `POST` | `/auth/logout` | Encerra a sessão |
| `GET` | `/auth/me` 🔒 | Usuário atual (com a assinatura, se houver) |
| `POST` | `/auth/forgot-password` | `{email}`: envia o link de nova senha |
| `POST` | `/auth/reset-password` | `{token, password}`: troca a senha e inicia a sessão |
| `GET` | `/catalog` | Profissionais e serviços ativos |
| `GET` | `/hours` | Horário de funcionamento e datas fechadas |
| `GET` | `/slots?date=AAAA-MM-DD&professional_id=p1&service_id=s1` | Horários livres (`exclude=id` ignora uma reserva, para remarcar) |
| `POST` | `/bookings` 🔒 | Cria reserva `{professional_id, service_id, date, time}` |
| `GET` | `/bookings` 🔒 | Reservas do cliente (mais recentes primeiro) |
| `PATCH` | `/bookings/{id}` 🔒 | Cancela: `{"status": "cancelled"}` (dono ou equipe) |
| `POST` | `/bookings/{id}/reschedule` 🔒 | Remarca: `{date, time}` (dono ou equipe) |
| `GET` | `/plans` | Planos mensais |
| `POST` | `/subscriptions/checkout?plan_id=executive` 🔒 | Abre o checkout e devolve `{url, demo}` |
| `POST` | `/stripe/webhook` | Confirma/cancela assinaturas a partir de eventos do Stripe |
| `GET` | `/admin/overview` 🛡️ | Números, agenda geral, assinaturas, profissionais e serviços (inclusive inativos), horários |
| `POST` | `/admin/professionals` 🛡️ | `{name, specialty, initials, color}` |
| `PATCH` | `/admin/professionals/{id}` 🛡️ | Edita qualquer campo; `{"active": false}` desativa |
| `POST` | `/admin/services` 🛡️ | `{name, duration, price, description}` |
| `PATCH` | `/admin/services/{id}` 🛡️ | Edita qualquer campo; `{"active": false}` desativa |
| `PUT` | `/admin/hours` 🛡️ | `{weekdays: [7 itens, segunda primeiro, {open, close} ou null], closed_dates: [...]}` |

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
| `FRONTEND_URL` | `RENDER_EXTERNAL_URL` ou `http://localhost:5173` | CORS, links dos e-mails e retornos do checkout |
| `CORS_ORIGINS` | `FRONTEND_URL` | Lista separada por vírgula, se houver mais de uma origem |
| `COOKIE_SECURE` | `false` | `true` quando servido por HTTPS; liga a checagem de segredos de produção |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@barbera.local` / `Barbera123!` | Conta da equipe criada na primeira subida |
| `STRIPE_API_KEY` | vazio | Liga o checkout real |
| `STRIPE_WEBHOOK_SECRET` | vazio | Liga o webhook |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | vazio / `587` | E-mail do "esqueci a senha" (STARTTLS). Sem `SMTP_HOST`, o link vai para o log |
| `TRUSTED_PROXY_HOPS` | `0` | Quantos proxies confiáveis ficam na frente da API (`1` no Render) |
| `STATIC_DIR` | `backend/static` | Pasta com o build do site; se existir, a API também serve o site |

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
