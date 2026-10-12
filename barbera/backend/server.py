"""API da Barbera: contas, agenda, reservas, planos mensais e visão da equipe.

FastAPI + MongoDB (Motor). A sessão é um JWT guardado em cookie HTTP-only, então
o frontend não toca no token; basta enviar as requisições com credenciais.
"""

import os
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Literal, Optional
from zoneinfo import ZoneInfo

import bcrypt
import jwt
import stripe
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field

load_dotenv()

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "barbera")
JWT_SECRET = os.environ.get("JWT_SECRET", "barbera-dev-secret-troque-em-producao-com-48-caracteres")
JWT_TTL = timedelta(days=7)
COOKIE_NAME = "barbera_session"
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173").rstrip("/")
CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", FRONTEND_URL).split(",") if o.strip()]
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@barbera.local").lower()
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Barbera123!")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
stripe.api_key = os.environ.get("STRIPE_API_KEY") or None

TZ = ZoneInfo(os.environ.get("TZ_BARBEARIA", "America/Sao_Paulo"))
OPEN_MINUTE = 9 * 60  # 09:00
CLOSE_MINUTE = 19 * 60  # 19:00
SLOT_STEP = 30  # minutos entre um início de horário e o próximo

SEED_PROFESSIONALS = [
    {"id": "p1", "name": "Rafael Costa", "specialty": "Cortes precisos", "initials": "RC", "color": "#356859"},
    {"id": "p2", "name": "Caio Martins", "specialty": "Barba & navalha", "initials": "CM", "color": "#ef8354"},
    {"id": "p3", "name": "Leo Almeida", "specialty": "Estilo autoral", "initials": "LA", "color": "#e0a458"},
]
SEED_SERVICES = [
    {"id": "s1", "name": "Corte clássico", "duration": 45, "price": 35,
     "description": "Tesoura e máquina, finalizado com lavagem"},
    {"id": "s2", "name": "Barba completa", "duration": 30, "price": 25,
     "description": "Toalha quente, navalha e hidratação"},
    {"id": "s3", "name": "Corte + barba", "duration": 70, "price": 55,
     "description": "O ritual completo, sem pressa"},
]
PLANS = [
    {"id": "gentleman", "name": "Gentleman", "price": 49,
     "perks": ["2 cortes por mês", "10% em produtos", "Reserva com 7 dias de antecedência"]},
    {"id": "executive", "name": "Executive", "price": 79, "featured": True,
     "perks": ["Cortes ilimitados", "1 barba por mês", "15% em produtos", "Reserva prioritária"]},
    {"id": "master", "name": "Master", "price": 119,
     "perks": ["Cortes e barbas ilimitados", "Profissional fixo", "20% em produtos", "Bebida da casa"]},
]
PLANS_BY_ID = {p["id"]: p for p in PLANS}

client: Optional[AsyncIOMotorClient] = None
db = None  # os testes trocam por um banco em memória antes de subir o app


async def seed() -> None:
    for prof in SEED_PROFESSIONALS:
        await db.professionals.update_one({"id": prof["id"]}, {"$setOnInsert": prof}, upsert=True)
    for svc in SEED_SERVICES:
        await db.services.update_one({"id": svc["id"]}, {"$setOnInsert": svc}, upsert=True)
    if not await db.users.find_one({"email": ADMIN_EMAIL}):
        await db.users.insert_one({
            "id": uuid.uuid4().hex,
            "name": "Equipe Barbera",
            "email": ADMIN_EMAIL,
            "password_hash": hash_password(ADMIN_PASSWORD),
            "role": "admin",
            "created_at": now_iso(),
        })
    await db.users.create_index("email", unique=True)
    await db.bookings.create_index([("professional_id", 1), ("date", 1)])


@asynccontextmanager
async def lifespan(_: FastAPI):
    global client, db
    if db is None:
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
    await seed()
    yield
    if client is not None:
        client.close()


app = FastAPI(title="Barbera API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
api = APIRouter(prefix="/api")


# ---------------------------------------------------------------- utilitários

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def check_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


def public_user(user: dict) -> dict:
    return {
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "role": user.get("role", "client"),
        "subscription": user.get("subscription"),
    }


def to_minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def fmt_minutes(total: int) -> str:
    return f"{total // 60:02d}:{total % 60:02d}"


def set_session(response: Response, user_id: str) -> None:
    token = jwt.encode(
        {"sub": user_id, "exp": datetime.now(timezone.utc) + JWT_TTL},
        JWT_SECRET,
        algorithm="HS256",
    )
    response.set_cookie(
        COOKIE_NAME, token,
        httponly=True, secure=COOKIE_SECURE, samesite="lax",
        max_age=int(JWT_TTL.total_seconds()), path="/",
    )


async def current_user(request: Request) -> dict:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(401, "Faça login para continuar")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Sessão expirada, faça login novamente")
    user = await db.users.find_one({"id": payload.get("sub")}, {"_id": 0})
    if not user:
        raise HTTPException(401, "Sessão inválida")
    return user


async def admin_user(user: dict = Depends(current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(403, "Acesso restrito à equipe")
    return user


# -------------------------------------------------------------------- modelos

class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    # bcrypt só considera 72 bytes; acima disso a versão 5 recusa a senha.
    password: str = Field(min_length=6, max_length=72)


class LoginIn(BaseModel):
    # str simples: o e-mail da equipe usa o domínio .local, que o EmailStr recusa.
    email: str = Field(max_length=254)
    password: str = Field(max_length=72)


class BookingIn(BaseModel):
    # O cliente também manda nomes e preço, mas o servidor ignora e usa o catálogo.
    professional_id: str
    service_id: str
    date: date
    time: str = Field(pattern=r"^\d{2}:\d{2}$")


class BookingPatch(BaseModel):
    status: Literal["cancelled"]


class ProfessionalIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    specialty: str = Field(min_length=2, max_length=80)
    initials: str = Field(min_length=1, max_length=3)
    color: str = Field(default="#356859", pattern=r"^#[0-9a-fA-F]{6}$")


class ServiceIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    duration: int = Field(ge=10, le=240)
    price: float = Field(ge=0, le=10000)
    description: str = Field(default="", max_length=200)


# --------------------------------------------------------------- autenticação

@api.get("/")
async def root():
    return {"message": "Barbera API", "stripe": "live" if stripe.api_key else "demo"}


@api.post("/auth/register", status_code=201)
async def register(body: RegisterIn, response: Response):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "Já existe uma conta com este e-mail")
    user = {
        "id": uuid.uuid4().hex,
        "name": body.name.strip(),
        "email": email,
        "password_hash": hash_password(body.password),
        "role": "client",
        "created_at": now_iso(),
    }
    await db.users.insert_one(dict(user))
    set_session(response, user["id"])
    return public_user(user)


@api.post("/auth/login")
async def login(body: LoginIn, response: Response):
    user = await db.users.find_one({"email": body.email.lower()}, {"_id": 0})
    if not user or not check_password(body.password, user["password_hash"]):
        raise HTTPException(401, "E-mail ou senha incorretos")
    set_session(response, user["id"])
    return public_user(user)


@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@api.get("/auth/me")
async def me(user: dict = Depends(current_user)):
    return public_user(user)


# --------------------------------------------------------- catálogo e agenda

@api.get("/catalog")
async def catalog():
    professionals = await db.professionals.find({}, {"_id": 0}).sort("name", 1).to_list(200)
    services = await db.services.find({}, {"_id": 0}).sort("price", 1).to_list(200)
    return {"professionals": professionals, "services": services}


async def free_slots(professional_id: str, day: date, duration: int) -> list[str]:
    today = datetime.now(TZ)
    if day < today.date():
        return []
    busy = []
    async for b in db.bookings.find(
        {"professional_id": professional_id, "date": day.isoformat(), "status": "confirmed"},
        {"_id": 0, "time": 1, "duration": 1},
    ):
        start = to_minutes(b["time"])
        busy.append((start, start + b["duration"]))

    earliest = OPEN_MINUTE
    if day == today.date():
        earliest = max(earliest, today.hour * 60 + today.minute + 1)

    slots = []
    for start in range(OPEN_MINUTE, CLOSE_MINUTE, SLOT_STEP):
        end = start + duration
        if start < earliest or end > CLOSE_MINUTE:
            continue
        if any(start < b_end and b_start < end for b_start, b_end in busy):
            continue
        slots.append(fmt_minutes(start))
    return slots


@api.get("/slots")
async def slots(date: date, professional_id: str, service_id: Optional[str] = None):
    if not await db.professionals.find_one({"id": professional_id}):
        raise HTTPException(404, "Profissional não encontrado")
    duration = SLOT_STEP
    if service_id:
        service = await db.services.find_one({"id": service_id})
        if not service:
            raise HTTPException(404, "Serviço não encontrado")
        duration = service["duration"]
    return {"date": date.isoformat(), "slots": await free_slots(professional_id, date, duration)}


@api.post("/bookings", status_code=201)
async def create_booking(body: BookingIn, user: dict = Depends(current_user)):
    professional = await db.professionals.find_one({"id": body.professional_id}, {"_id": 0})
    service = await db.services.find_one({"id": body.service_id}, {"_id": 0})
    if not professional or not service:
        raise HTTPException(404, "Profissional ou serviço não encontrado")
    if body.time not in await free_slots(professional["id"], body.date, service["duration"]):
        raise HTTPException(409, "Esse horário não está mais disponível")

    booking = {
        "id": uuid.uuid4().hex,
        "user_id": user["id"],
        "user_name": user["name"],
        "user_email": user["email"],
        "professional_id": professional["id"],
        "professional_name": professional["name"],
        "service_id": service["id"],
        "service_name": service["name"],
        "duration": service["duration"],
        "price": service["price"],
        "date": body.date.isoformat(),
        "time": body.time,
        "status": "confirmed",
        "created_at": now_iso(),
    }
    await db.bookings.insert_one(dict(booking))
    return booking


@api.get("/bookings")
async def my_bookings(user: dict = Depends(current_user)):
    return await db.bookings.find({"user_id": user["id"]}, {"_id": 0}).sort(
        [("date", -1), ("time", -1)]
    ).to_list(500)


@api.patch("/bookings/{booking_id}")
async def update_booking(booking_id: str, body: BookingPatch, user: dict = Depends(current_user)):
    booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not booking or (booking["user_id"] != user["id"] and user.get("role") != "admin"):
        raise HTTPException(404, "Reserva não encontrada")
    if booking["status"] != "confirmed":
        raise HTTPException(409, "Essa reserva já foi cancelada")
    await db.bookings.update_one({"id": booking_id}, {"$set": {"status": body.status}})
    booking["status"] = body.status
    return booking


# ------------------------------------------------------------ planos (Stripe)

@api.get("/plans")
async def plans():
    return PLANS


@api.post("/subscriptions/checkout")
async def checkout(plan_id: str, user: dict = Depends(current_user)):
    plan = PLANS_BY_ID.get(plan_id)
    if not plan:
        raise HTTPException(404, "Plano não encontrado")

    if not stripe.api_key:
        # Sem chave Stripe o fluxo continua navegável: a assinatura é marcada como
        # demonstrativa e o retorno imita o sucesso do checkout. Nada é cobrado.
        await db.users.update_one({"id": user["id"]}, {"$set": {"subscription": {
            "plan_id": plan["id"], "plan_name": plan["name"], "status": "demo", "updated_at": now_iso(),
        }}})
        return {"url": f"{FRONTEND_URL}/planos?subscription=success&demo=1", "demo": True}

    session = stripe.checkout.Session.create(
        mode="subscription",
        line_items=[{
            "price_data": {
                "currency": "brl",
                "product_data": {"name": f"Barbera {plan['name']}"},
                "unit_amount": plan["price"] * 100,
                "recurring": {"interval": "month"},
            },
            "quantity": 1,
        }],
        customer_email=user["email"],
        client_reference_id=user["id"],
        metadata={"user_id": user["id"], "plan_id": plan["id"]},
        success_url=f"{FRONTEND_URL}/planos?subscription=success",
        cancel_url=f"{FRONTEND_URL}/planos?subscription=cancelled",
    )
    await db.users.update_one({"id": user["id"]}, {"$set": {"subscription": {
        "plan_id": plan["id"], "plan_name": plan["name"], "status": "pending",
        "checkout_session_id": session.id, "updated_at": now_iso(),
    }}})
    return {"url": session.url, "demo": False}


@api.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    """Confirma a assinatura quando o Stripe avisa que o pagamento passou."""
    if not STRIPE_WEBHOOK_SECRET:
        raise HTTPException(503, "Webhook Stripe não configurado")
    payload = await request.body()
    try:
        event = stripe.Webhook.construct_event(
            payload, request.headers.get("stripe-signature", ""), STRIPE_WEBHOOK_SECRET
        )
    except (ValueError, stripe.SignatureVerificationError):
        raise HTTPException(400, "Assinatura do webhook inválida")

    obj = event["data"]["object"]
    if event["type"] == "checkout.session.completed":
        await db.users.update_one(
            {"id": obj.get("client_reference_id")},
            {"$set": {
                "subscription.status": "active",
                "subscription.stripe_subscription_id": obj.get("subscription"),
                "subscription.updated_at": now_iso(),
            }},
        )
    elif event["type"] == "customer.subscription.deleted":
        await db.users.update_one(
            {"subscription.stripe_subscription_id": obj.get("id")},
            {"$set": {"subscription.status": "cancelled", "subscription.updated_at": now_iso()}},
        )
    return {"received": True}


# ---------------------------------------------------------------- equipe

@api.get("/admin/overview")
async def admin_overview(_: dict = Depends(admin_user)):
    bookings = await db.bookings.find({}, {"_id": 0}).sort([("date", 1), ("time", 1)]).to_list(1000)
    subscribers = await db.users.find(
        {"subscription": {"$exists": True}},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "subscription": 1},
    ).to_list(1000)
    confirmed = [b for b in bookings if b["status"] == "confirmed"]
    return {
        "stats": {
            "clients": await db.users.count_documents({"role": "client"}),
            "bookings": len(confirmed),
            "professionals": await db.professionals.count_documents({}),
            "revenue": sum(b["price"] for b in confirmed),
        },
        "bookings": bookings,
        "subscriptions": subscribers,
        **(await catalog()),
    }


@api.post("/admin/professionals", status_code=201)
async def add_professional(body: ProfessionalIn, _: dict = Depends(admin_user)):
    prof = {"id": "p" + uuid.uuid4().hex[:8], **body.model_dump()}
    prof["initials"] = prof["initials"].upper()
    await db.professionals.insert_one(dict(prof))
    return prof


@api.post("/admin/services", status_code=201)
async def add_service(body: ServiceIn, _: dict = Depends(admin_user)):
    svc = {"id": "s" + uuid.uuid4().hex[:8], **body.model_dump()}
    await db.services.insert_one(dict(svc))
    return svc


app.include_router(api)
