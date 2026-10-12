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
| Catálogo | Profissionais e serviços vindos do banco, com dados iniciais |
| Horários | Disponibilidade calculada pela duração do serviço, sem sobreposição, só no futuro |
| Reservas | Criar, listar, cancelar; servidor revalida o horário e usa o preço do catálogo |
| Planos | 3 planos; checkout Stripe real com chave, demonstrativo sem chave; status gravado no usuário |
| Webhook | Confirma (`active`) e cancela (`cancelled`) assinaturas a partir do Stripe |
| Equipe | Visão geral, agenda geral, assinantes, cadastro de profissional e serviço |
| Acesso | Rotas da equipe exigem `role: admin`; cliente só vê e cancela as próprias reservas |
| Concorrência | Trava no banco (índice único por bloco de 30 min) impede reservas simultâneas no mesmo horário |
| Segurança | Limite de tentativas de login erradas por e-mail + IP e por IP (15 min) |
| Interface | Responsiva: barra lateral no desktop, cabeçalho + barra inferior no celular |

## Backlog

### P0
- Configurar `STRIPE_API_KEY` e `STRIPE_WEBHOOK_SECRET` de teste e validar o ciclo completo.

### P1
- Editar e desativar profissionais e serviços.
- Horários de funcionamento configuráveis (por dia e por profissional), folgas e feriados.
- Reagendamento.
- Lembretes por e-mail/WhatsApp.
- Portal do cliente Stripe para trocar ou cancelar o plano.
- Aplicar os benefícios do plano no preço da reserva.

### P2
- Programa de fidelidade e cupons.
- Loja de produtos.
- Avaliação dos profissionais.
- Histórico financeiro e relatórios mensais.
