from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient

import server

TOMORROW = (date.today() + timedelta(days=2)).isoformat()


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
