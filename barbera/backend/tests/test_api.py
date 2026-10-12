from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient

import server


def next_weekday(weekday, after_days=1):
    """Próxima data (a partir de amanhã) que cai no dia da semana pedido (0 = segunda)."""
    d = date.today() + timedelta(days=after_days)
    while d.weekday() != weekday:
        d += timedelta(days=1)
    return d


# Sempre uma quarta-feira futura: aberta no horário padrão, seja qual for o dia do teste.
TOMORROW = next_weekday(2).isoformat()


@pytest.fixture
def make_client(monkeypatch):
    monkeypatch.setattr(server, "db", AsyncMongoMockClient()["barbera_test"])
    monkeypatch.setattr(server.stripe, "api_key", None)
    clients = []

    def make():
        c = TestClient(server.app)
        c.__enter__()
        clients.append(c)
        return c

    yield make
    for c in clients:
        c.__exit__(None, None, None)


def register(client, email="joao@example.com"):
    r = client.post("/api/auth/register", json={"name": "João da Silva", "email": email, "password": "123456"})
    assert r.status_code == 201, r.text
    return r.json()


def book(client, time="14:00", service_id="s1", professional_id="p1"):
    return client.post("/api/bookings", json={
        "professional_id": professional_id, "service_id": service_id, "date": TOMORROW, "time": time,
        # campos que o servidor deve ignorar
        "price": 1, "service_name": "x",
    })


def test_register_login_me_logout(make_client):
    c = make_client()
    user = register(c)
    assert user["role"] == "client"
    assert c.get("/api/auth/me").json()["email"] == "joao@example.com"

    assert c.post("/api/auth/logout").status_code == 200
    assert c.get("/api/auth/me").status_code == 401

    assert c.post("/api/auth/login", json={"email": "joao@example.com", "password": "errada"}).status_code == 401
    assert c.post("/api/auth/login", json={"email": "JOAO@example.com", "password": "123456"}).status_code == 200
    assert c.get("/api/auth/me").status_code == 200


def test_duplicate_email(make_client):
    c = make_client()
    register(c)
    r = c.post("/api/auth/register", json={"name": "Outro", "email": "joao@example.com", "password": "123456"})
    assert r.status_code == 409


def test_catalog_seeded(make_client):
    data = make_client().get("/api/catalog").json()
    assert {p["id"] for p in data["professionals"]} == {"p1", "p2", "p3"}
    assert {s["id"] for s in data["services"]} == {"s1", "s2", "s3"}


def test_booking_uses_catalog_price_and_blocks_overlap(make_client):
    c = make_client()
    register(c)
    r = book(c, "14:00")  # corte clássico: 45 min, ocupa 14:00-14:45
    assert r.status_code == 201, r.text
    assert r.json()["price"] == 35
    assert r.json()["service_name"] == "Corte clássico"

    slots = c.get("/api/slots", params={"date": TOMORROW, "professional_id": "p1", "service_id": "s2"}).json()["slots"]
    assert "14:00" not in slots and "14:30" not in slots
    assert "13:30" in slots and "15:00" in slots
    # 13:30 + 70 min invade a reserva das 14:00
    long_slots = c.get("/api/slots", params={"date": TOMORROW, "professional_id": "p1", "service_id": "s3"}).json()["slots"]
    assert "13:30" not in long_slots and "12:30" in long_slots
    # o último início possível respeita o fechamento às 19:00
    assert "18:30" in slots and "18:30" not in long_slots

    assert book(c, "14:30", "s2").status_code == 409
    assert book(c, "14:00", "s1", "p2").status_code == 201  # outro profissional está livre


def test_cancel_and_history(make_client):
    c = make_client()
    register(c)
    booking = book(c).json()
    r = c.patch(f"/api/bookings/{booking['id']}", json={"status": "cancelled"})
    assert r.json()["status"] == "cancelled"
    assert c.patch(f"/api/bookings/{booking['id']}", json={"status": "cancelled"}).status_code == 409
    assert book(c).status_code == 201  # horário liberado de novo
    assert len(c.get("/api/bookings").json()) == 2


def test_cannot_cancel_someone_elses_booking(make_client):
    a, b = make_client(), make_client()
    register(a, "a@example.com")
    register(b, "b@example.com")
    booking = book(a).json()
    assert b.patch(f"/api/bookings/{booking['id']}", json={"status": "cancelled"}).status_code == 404
    assert b.get("/api/bookings").json() == []


def test_past_dates_have_no_slots(make_client):
    c = make_client()
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    assert c.get("/api/slots", params={"date": yesterday, "professional_id": "p1"}).json()["slots"] == []


def test_admin_area(make_client):
    client = make_client()
    register(client)
    book(client)
    assert client.get("/api/admin/overview").status_code == 403

    admin = make_client()
    r = admin.post("/api/auth/login", json={"email": "admin@barbera.local", "password": "Barbera123!"})
    assert r.status_code == 200 and r.json()["role"] == "admin"

    overview = admin.get("/api/admin/overview").json()
    assert overview["stats"] == {"clients": 1, "bookings": 1, "professionals": 3, "revenue": 35}

    r = admin.post("/api/admin/professionals", json={
        "name": "Bruno Mendes", "specialty": "Cortes modernos", "initials": "bm", "color": "#ef8354"})
    assert r.status_code == 201 and r.json()["initials"] == "BM"
    r = admin.post("/api/admin/services", json={
        "name": "Corte degradê", "duration": 50, "price": 45, "description": "Degradê personalizado"})
    assert r.status_code == 201
    assert len(admin.get("/api/catalog").json()["services"]) == 4


def test_demo_checkout(make_client):
    c = make_client()
    assert len(c.get("/api/plans").json()) == 3
    register(c)
    assert c.post("/api/subscriptions/checkout", params={"plan_id": "nenhum"}).status_code == 404
    r = c.post("/api/subscriptions/checkout", params={"plan_id": "executive"}).json()
    assert r["demo"] is True and "subscription=success" in r["url"]
    assert c.get("/api/auth/me").json()["subscription"]["status"] == "demo"


def test_webhook_requires_secret(make_client):
    assert make_client().post("/api/stripe/webhook", content=b"{}").status_code == 503


def test_simultaneous_bookings_are_blocked_by_the_database(make_client, monkeypatch):
    # Simula duas requisições que passaram juntas pela checagem de horários livres.
    async def always_free(professional_id, day, duration):
        return ["14:00", "14:30", "15:00"]

    monkeypatch.setattr(server, "free_slots", always_free)
    c = make_client()
    register(c)
    first = book(c, "14:00", "s1")  # 45 min: ocupa os blocos 14:00 e 14:30
    assert first.status_code == 201
    assert book(c, "14:00", "s2").status_code == 409
    assert book(c, "14:30", "s2").status_code == 409
    assert book(c, "15:00", "s2").status_code == 201
    assert book(c, "14:30", "s2", "p2").status_code == 201  # outro profissional

    c.patch(f"/api/bookings/{first.json()['id']}", json={"status": "cancelled"})
    assert book(c, "14:30", "s2").status_code == 201  # cancelar libera os blocos


def login(client, email, password):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def test_login_is_limited_per_account(make_client):
    c = make_client()
    register(c, "alvo@example.com")
    for _ in range(server.LOGIN_MAX_PER_ACCOUNT):
        assert login(c, "alvo@example.com", "errada").status_code == 401
    r = login(c, "alvo@example.com", "123456")
    assert r.status_code == 429 and "Retry-After" in r.headers
    # outra conta do mesmo IP continua entrando
    register(c, "outra@example.com")
    assert login(c, "outra@example.com", "123456").status_code == 200


def test_successful_login_resets_the_counter(make_client):
    c = make_client()
    register(c)
    for _ in range(server.LOGIN_MAX_PER_ACCOUNT - 1):
        login(c, "joao@example.com", "errada")
    assert login(c, "joao@example.com", "123456").status_code == 200
    for _ in range(server.LOGIN_MAX_PER_ACCOUNT - 1):
        assert login(c, "joao@example.com", "errada").status_code == 401


def test_login_is_limited_per_ip(make_client):
    c = make_client()
    for i in range(server.LOGIN_MAX_PER_IP):
        login(c, f"pessoa{i}@example.com", "errada")
    assert login(c, "admin@barbera.local", "Barbera123!").status_code == 429


# ---------------------------------------------------------------- equipe edita

def admin_client(make_client):
    a = make_client()
    assert login(a, "admin@barbera.local", "Barbera123!").status_code == 200
    return a


def test_deactivated_professional_leaves_catalog_but_not_history(make_client):
    c = make_client()
    register(c)
    booking = book(c).json()
    admin = admin_client(make_client)

    r = admin.patch("/api/admin/professionals/p1", json={"active": False, "name": "Rafael C."})
    assert r.status_code == 200 and r.json()["active"] is False
    assert "p1" not in {p["id"] for p in c.get("/api/catalog").json()["professionals"]}
    assert book(c, "16:00").status_code == 404
    assert c.get("/api/slots", params={"date": TOMORROW, "professional_id": "p1"}).status_code == 404
    # a reserva antiga continua lá, com o nome da época
    assert c.get("/api/bookings").json()[0]["professional_name"] == "Rafael Costa"
    overview = admin.get("/api/admin/overview").json()
    assert "p1" in {p["id"] for p in overview["professionals"]}
    assert overview["stats"]["professionals"] == 2

    admin.patch("/api/admin/professionals/p1", json={"active": True})
    assert book(c, "16:00").status_code == 201
    assert booking["id"]


def test_edit_service_applies_to_new_bookings_only(make_client):
    c = make_client()
    register(c)
    first = book(c, "10:00").json()
    admin = admin_client(make_client)
    r = admin.patch("/api/admin/services/s1", json={"price": 40, "duration": 60})
    assert r.json()["price"] == 40
    second = book(c, "15:00").json()
    assert (first["price"], first["duration"]) == (35, 45)
    assert (second["price"], second["duration"]) == (40, 60)


def test_edit_validation_and_permissions(make_client):
    c = make_client()
    register(c)
    assert c.patch("/api/admin/services/s1", json={"price": 1}).status_code == 403
    admin = admin_client(make_client)
    assert admin.patch("/api/admin/services/s1", json={}).status_code == 400
    assert admin.patch("/api/admin/services/nao-existe", json={"price": 1}).status_code == 404
    assert admin.patch("/api/admin/professionals/p1", json={"color": "vermelho"}).status_code == 422


# ------------------------------------------------------------ horários da casa

def week(open_="09:00", close="19:00", sunday=None):
    return [{"open": open_, "close": close}] * 6 + [sunday]


def test_default_hours_close_on_sunday(make_client):
    c = make_client()
    sunday = next_weekday(6).isoformat()
    assert c.get("/api/slots", params={"date": sunday, "professional_id": "p1"}).json()["slots"] == []
    assert c.get("/api/hours").json()["weekdays"][6] is None


def test_admin_changes_hours_and_closed_dates(make_client):
    c = make_client()
    register(c)
    admin = admin_client(make_client)
    holiday = next_weekday(4)  # uma sexta
    r = admin.put("/api/admin/hours", json={
        "weekdays": week("10:00", "14:00", {"open": "09:00", "close": "12:00"}),
        "closed_dates": [holiday.isoformat()],
    })
    assert r.status_code == 200

    slots = c.get("/api/slots", params={"date": TOMORROW, "professional_id": "p1", "service_id": "s2"}).json()["slots"]
    assert slots[0] == "10:00" and slots[-1] == "13:30"
    sunday = next_weekday(6).isoformat()
    assert c.get("/api/slots", params={"date": sunday, "professional_id": "p1"}).json()["slots"][0] == "09:00"
    assert c.get("/api/slots", params={"date": holiday.isoformat(), "professional_id": "p1"}).json()["slots"] == []
    assert book(c, "09:00").status_code == 409  # fora do novo horário


def test_hours_validation(make_client):
    c = make_client()
    register(c)
    assert c.put("/api/admin/hours", json={"weekdays": week()}).status_code == 403
    admin = admin_client(make_client)
    assert admin.put("/api/admin/hours", json={"weekdays": week("19:00", "09:00")}).status_code == 422
    assert admin.put("/api/admin/hours", json={"weekdays": week("09:15", "18:00")}).status_code == 422
    assert admin.put("/api/admin/hours", json={"weekdays": week()[:6]}).status_code == 422


# ------------------------------------------------------------------ remarcar

def test_reschedule_moves_the_booking_and_its_blocks(make_client):
    c = make_client()
    register(c)
    booking = book(c, "14:00").json()  # 45 min: 14:00 e 14:30
    # empurrar 30 min para frente sobrepõe o próprio horário, e pode
    r = c.post(f"/api/bookings/{booking['id']}/reschedule", json={"date": TOMORROW, "time": "14:30"})
    assert r.status_code == 200 and r.json()["time"] == "14:30"
    assert book(c, "14:00", "s2").status_code == 201  # 14:00 foi liberado
    assert book(c, "15:00", "s2").status_code == 409  # 15:00 agora é da reserva remarcada

    other_day = next_weekday(3).isoformat()
    r = c.post(f"/api/bookings/{booking['id']}/reschedule", json={"date": other_day, "time": "10:00"})
    assert r.json()["date"] == other_day
    assert book(c, "15:00", "s2").status_code == 201  # o dia antigo ficou livre
    assert len(c.get("/api/bookings").json()) == 3


def test_reschedule_rules(make_client):
    a, b = make_client(), make_client()
    register(a, "a@example.com")
    register(b, "b@example.com")
    mine = book(a, "10:00").json()
    book(b, "16:00")
    url = f"/api/bookings/{mine['id']}/reschedule"
    assert a.post(url, json={"date": TOMORROW, "time": "16:00"}).status_code == 409  # ocupado
    assert b.post(url, json={"date": TOMORROW, "time": "11:00"}).status_code == 404  # reserva de outro
    a.patch(f"/api/bookings/{mine['id']}", json={"status": "cancelled"})
    assert a.post(url, json={"date": TOMORROW, "time": "11:00"}).status_code == 409


# ------------------------------------------------------------ esqueci a senha

@pytest.fixture
def outbox(monkeypatch):
    sent = []

    async def fake_send(to, subject, text):
        sent.append({"to": to, "subject": subject, "text": text})

    monkeypatch.setattr(server, "send_email", fake_send)
    return sent


def reset_token(mail):
    return mail["text"].split("token=")[1].split()[0]


def test_password_reset_flow(make_client, outbox):
    c = make_client()
    register(c)
    old_session = make_client()
    login(old_session, "joao@example.com", "123456")

    unknown = c.post("/api/auth/forgot-password", json={"email": "ninguem@example.com"})
    known = c.post("/api/auth/forgot-password", json={"email": "JOAO@example.com"})
    assert unknown.json() == known.json()  # não revela quem tem conta
    assert len(outbox) == 1 and outbox[0]["to"] == "joao@example.com"

    token = reset_token(outbox[0])
    fresh = make_client()
    r = fresh.post("/api/auth/reset-password", json={"token": token, "password": "nova-senha"})
    assert r.status_code == 200
    assert fresh.get("/api/auth/me").status_code == 200  # já entra logado

    assert old_session.get("/api/auth/me").status_code == 401  # sessões antigas caem
    assert login(make_client(), "joao@example.com", "123456").status_code == 401
    assert login(make_client(), "joao@example.com", "nova-senha").status_code == 200
    # o link vale uma vez só
    assert fresh.post("/api/auth/reset-password", json={"token": token, "password": "outra-senha"}).status_code == 400


def test_password_reset_expiry_and_limit(make_client, outbox):
    c = make_client()
    register(c)
    for _ in range(server.RESET_MAX_PER_HOUR + 2):
        c.post("/api/auth/forgot-password", json={"email": "joao@example.com"})
    assert len(outbox) == server.RESET_MAX_PER_HOUR

    import asyncio
    from datetime import datetime, timezone
    asyncio.run(server.db.password_resets.update_many(
        {}, {"$set": {"expires_at": datetime.now(timezone.utc) - timedelta(minutes=1)}}
    ))
    r = c.post("/api/auth/reset-password", json={"token": reset_token(outbox[0]), "password": "nova-senha"})
    assert r.status_code == 400


# ---------------------------------------------------------- configuração

def test_production_refuses_dev_secrets(monkeypatch):
    monkeypatch.setattr(server, "COOKIE_SECURE", True)
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        server.check_production_config()
    monkeypatch.setattr(server, "JWT_SECRET", "x" * 48)
    with pytest.raises(RuntimeError, match="ADMIN_PASSWORD"):
        server.check_production_config()
    monkeypatch.setattr(server, "ADMIN_PASSWORD", "uma-senha-forte")
    server.check_production_config()


def test_login_is_limited_per_email_across_ips(make_client, monkeypatch):
    c = make_client()
    register(c)
    ips = iter(f"10.0.0.{i}" for i in range(100))
    monkeypatch.setattr(server, "client_ip", lambda request: next(ips))
    for _ in range(server.LOGIN_MAX_PER_EMAIL):
        assert login(c, "joao@example.com", "errada").status_code == 401
    assert login(c, "joao@example.com", "123456").status_code == 429


def test_client_ip_uses_only_trusted_proxy_entries(monkeypatch):
    class Req:
        def __init__(self, xff):
            self.client = type("C", (), {"host": "10.9.9.9"})()
            self.headers = {"x-forwarded-for": xff} if xff else {}

    assert server.client_ip(Req("1.1.1.1")) == "10.9.9.9"  # sem proxy configurado, ignora o cabeçalho
    monkeypatch.setattr(server, "TRUSTED_PROXY_HOPS", 1)
    # o visitante mandou "6.6.6.6"; o proxy acrescentou o IP real no fim
    assert server.client_ip(Req("6.6.6.6, 203.0.113.7")) == "203.0.113.7"
    assert server.client_ip(Req(None)) == "10.9.9.9"
