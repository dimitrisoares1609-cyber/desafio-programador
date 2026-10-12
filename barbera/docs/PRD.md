# Barbera — documento de produto

## Problema

Barbearias pequenas ainda marcam horário por mensagem e caderno: o cliente não vê
o que está livre, a equipe não sabe quem vem amanhã, e não há receita recorrente.
A Barbera dá ao cliente a reserva em poucos toques e à barbearia uma agenda única
e um clube de assinatura.

## Personas

- **Cliente** — quer marcar com o profissional de sempre, ver os próximos horários
  e cancelar sem ligar. Usa principalmente o celular.
- **Equipe / dono** — quer ver a agenda do dia, quantos clientes e assinantes tem
  e manter o cardápio de serviços e profissionais.

## Fluxos

### Cliente

1. Acessa o sistema e cria conta ou entra.
2. Vê a agenda pessoal (próximo horário em destaque, próximas reservas, histórico).
3. Em "Reservar horário" escolhe profissional → serviço → data → horário livre.
4. Confirma; a reserva aparece na agenda.
5. Pode cancelar uma reserva futura.
6. Em "Planos mensais" assina Gentleman, Executive ou Master pelo checkout.

### Equipe

1. Entra com uma conta de papel `admin`.
2. Em "Visão da equipe" vê clientes, reservas ativas, profissionais e receita
   reservada; a agenda geral agrupada por dia; e os assinantes com status.
3. Cadastra profissionais e serviços.

## Requisitos implementados

| Área | Requisito |
|---|---|
| Conta | Cadastro, login, sessão persistente (cookie HTTP-only, 7 dias), logout no desktop e no celular |
| Senha | "Esqueci a senha" com link por e-mail (1 hora, uso único); trocar a senha encerra as outras sessões |
| Catálogo | Profissionais e serviços vindos do banco, com dados iniciais |
| Horários | Disponibilidade calculada pela duração do serviço, sem sobreposição, só no futuro |
| Reservas | Criar, listar, remarcar, cancelar; servidor revalida o horário e usa o preço do catálogo |
| Horários | Equipe define funcionamento por dia da semana, folgas e feriados |
| Planos | 3 planos; checkout Stripe real com chave, demonstrativo sem chave; status gravado no usuário |
| Webhook | Confirma (`active`) e cancela (`cancelled`) assinaturas a partir do Stripe |
| Equipe | Visão geral, agenda geral (com cancelamento), assinantes, cadastrar, editar, desativar e reativar profissionais e serviços |
| Acesso | Rotas da equipe exigem `role: admin`; cliente só vê e cancela as próprias reservas |
| Concorrência | Trava no banco (índice único por bloco de 30 min) impede reservas simultâneas no mesmo horário |
| Segurança | Limite de tentativas de login (e-mail + IP, IP e e-mail); API não sobe em produção com segredos de desenvolvimento |
| Publicação | Imagem Docker única (site + API) e blueprint do Render; banco no MongoDB Atlas |
| Interface | Responsiva: barra lateral no desktop, cabeçalho + barra inferior no celular |

## Backlog

### P0
- Configurar `STRIPE_API_KEY` e `STRIPE_WEBHOOK_SECRET` de teste e validar o ciclo completo.
- Publicar no Render com MongoDB Atlas e SMTP configurados.

### P1
- Horários e folgas por profissional (hoje valem para a casa toda).
- Lembretes por e-mail/WhatsApp antes do horário.
- Confirmação de e-mail no cadastro.
- Portal do cliente Stripe para trocar ou cancelar o plano.
- Aplicar os benefícios do plano no preço da reserva.

### P2
- Programa de fidelidade e cupons.
- Loja de produtos.
- Avaliação dos profissionais.
- Histórico financeiro e relatórios mensais.
