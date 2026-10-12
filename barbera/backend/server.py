"""API da Barbera: contas, agenda, reservas, planos mensais e visão da equipe.

FastAPI + MongoDB (Motor). A sessão é um JWT guardado em cookie HTTP-only, então
o frontend não toca no token; basta enviar as requisições com credenciais.
"""

import asyncio
import hashlib
import logging
import math
import os
import secrets
import smtplib
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Literal, Optional
from zoneinfo import ZoneInfo

import bcrypt
import jwt
import stripe
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator
from pymongo.errors import DuplicateKeyError

load_dotenv()
log = logging.getLogger("barbera")

DEV_JWT_SECRET = "barbera-dev-secret-troque-em-producao-com-48-caracteres"
DEV_ADMIN_PASSWORD = "Barbera123!"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "barbera")
JWT_SECRET = os.environ.get("JWT_SECRET", DEV_JWT_SECRET)
JWT_TTL = timedelta(days=7)
COOKIE_NAME = "barbera_session"
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"
# No Render o endereço público vem em RENDER_EXTERNAL_URL, sem precisar configurar.
FRONTEND_URL = (
    os.environ.get("FRONTEND_URL") or os.environ.get("RENDER_EXTERNAL_URL") or "http://localhost:5173"
).rstrip("/")
CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", FRONTEND_URL).split(",") if o.strip()]
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@barbera.local").lower()
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", DEV_ADMIN_PASSWORD)
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
stripe.api_key = os.environ.get("STRIPE_API_KEY") or None

SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("SMTP_FROM", SMTP_USER or "nao-responda@barbera.local")

# Quantos proxies confiáveis ficam na frente da API (ex.: 1 no Render). Cada um
# acrescenta o IP de quem falou com ele ao fim do X-Forwarded-For; só essas
# entradas do fim são confiáveis, o começo do cabeçalho o visitante pode inventar.
TRUSTED_PROXY_HOPS = int(os.environ.get("TRUSTED_PROXY_HOPS", "0"))

# Pasta com o build do React. Quando existe, a API também serve o site (imagem única).
STATIC_DIR = Path(os.environ.get("STATIC_DIR", Path(__file__).parent / "static"))

TZ = ZoneInfo(os.environ.get("TZ_BARBEARIA", "America/Sao_Paulo"))
SLOT_STEP = 30  # minutos entre um início de horário e o próximo
# Índice = dia da semana do Python (0 = segunda). None = fechado.
DEFAULT_WEEKDAYS = [{"open": "09:00", "close": "19:00"}] * 6 + [None]

# Limite de tentativas de login erradas dentro da janela: por IP + e-mail
# (protege uma conta), só por IP (impede testar uma senha em muitos e-mails) e
# só por e-mail (segura quem troca de IP a cada tentativa).
LOGIN_WINDOW = timedelta(minutes=15)
LOGIN_MAX_PER_ACCOUNT = 5
LOGIN_MAX_PER_IP = 20
LOGIN_MAX_PER_EMAIL = 10

RESET_TTL = timedelta(hours=1)
RESET_MAX_PER_HOUR = 3

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
ACTIVE = {"active": {"$ne": False}}  # documentos antigos não têm o campo e contam como ativos

client: Optional[AsyncIOMotorClient] = None
db = None  # os testes trocam por um banco em memória antes de subir o app


def check_production_config() -> None:
    # COOKIE_SECURE=true significa site em HTTPS, ou seja, publicado: aí os valores
    # de desenvolvimento deixariam qualquer um entrar como equipe ou forjar sessões.
    if not COOKIE_SECURE:
        return
    problems = []
    if JWT_SECRET == DEV_JWT_SECRET or len(JWT_SECRET) < 32:
        problems.append("JWT_SECRET (use um valor aleatório com 32+ caracteres)")
    if ADMIN_PASSWORD == DEV_ADMIN_PASSWORD:
        problems.append("ADMIN_PASSWORD")
    if problems:
        raise RuntimeError("Configuração de produção insegura, defina: " + ", ".join(problems))


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
    # Cada reserva ocupa blocos de 30 min do profissional; o índice único é o
    # que impede duas reservas no mesmo bloco mesmo se chegarem ao mesmo tempo.
    await db.slot_locks.create_index([("professional_id", 1), ("date", 1), ("block", 1)], unique=True)
    await db.slot_locks.create_index("booking_id")
    await db.login_failures.create_index("created_at", expireAfterSeconds=int(LOGIN_WINDOW.total_seconds()))
    await db.login_failures.create_index([("ip", 1), ("email", 1)])
    await db.login_failures.create_index("email")
    await db.password_resets.create_index("expires_at", expireAfterSeconds=0)
    await db.password_resets.create_index("token_hash", unique=True)
    # Reservas criadas antes das travas existirem ganham as suas.
    async for b in db.bookings.find({"status": "confirmed", "date": {"$gte": datetime.now(TZ).date().isoformat()}}):
        for lock in slot_locks_for(b):
            await db.slot_locks.update_one(
                {k: lock[k] for k in ("professional_id", "date", "block")},
                {"$setOnInsert": lock}, upsert=True,
            )


@asynccontextmanager
async def lifespan(_: FastAPI):
    global client, db
    check_production_config()
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


def slot_locks_for(booking: dict) -> list[dict]:
    start = to_minutes(booking["time"])
    blocks = math.ceil(booking["duration"] / SLOT_STEP)
    return [
        {
            "professional_id": booking["professional_id"],
            "date": booking["date"],
            "block": fmt_minutes(start + i * SLOT_STEP),
            "booking_id": booking["id"],
        }
        for i in range(blocks)
    ]


def client_ip(request: Request) -> str:
    peer = request.client.host if request.client else "desconhecido"
    if TRUSTED_PROXY_HOPS <= 0:
        return peer
    hops = [h.strip() for h in request.headers.get("x-forwarded-for", "").split(",") if h.strip()]
    if len(hops) < TRUSTED_PROXY_HOPS:
        return peer
    return hops[-TRUSTED_PROXY_HOPS]


def set_session(response: Response, user: dict) -> None:
    token = jwt.encode(
        {
            "sub": user["id"],
            # Trocar a senha incrementa a versão e derruba as sessões antigas.
            "ver": user.get("session_version", 0),
            "exp": datetime.now(timezone.utc) + JWT_TTL,
        },
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
    if not user or payload.get("ver", 0) != user.get("session_version", 0):
        raise HTTPException(401, "Sessão inválida, faça login novamente")
    return user


async def admin_user(user: dict = Depends(current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(403, "Acesso restrito à equipe")
    return user


def _send_email_sync(to: str, subject: str, text: str) -> None:
    msg = EmailMessage()
    msg["From"] = SMTP_FROM
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as smtp:
        smtp.starttls()
        if SMTP_USER:
            smtp.login(SMTP_USER, SMTP_PASSWORD)
        smtp.send_message(msg)


async def send_email(to: str, subject: str, text: str) -> None:
    if not SMTP_HOST:
        # Sem SMTP (desenvolvimento) o e-mail vai para o log do servidor.
        log.warning("SMTP não configurado; e-mail para %s não enviado:\n%s\n%s", to, subject, text)
        return
    try:
        await asyncio.to_thread(_send_email_sync, to, subject, text)
    except Exception:
        log.exception("Falha ao enviar e-mail para %s", to)


# ------------------------------------------------------------ horários da casa

async def get_hours() -> dict:
    doc = await db.settings.find_one({"id": "hours"}, {"_id": 0}) or {}
    return {
        "weekdays": doc.get("weekdays", DEFAULT_WEEKDAYS),
        "closed_dates": sorted(doc.get("closed_dates", [])),
    }


def opening_for(hours: dict, day: date) -> Optional[tuple[int, int]]:
    if day.isoformat() in hours["closed_dates"]:
        return None
    period = hours["weekdays"][day.weekday()]
    if not period:
        return None
    return to_minutes(period["open"]), to_minutes(period["close"])


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


class ForgotIn(BaseModel):
    email: str = Field(max_length=254)


class ResetIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    password: str = Field(min_length=6, max_length=72)


class BookingIn(BaseModel):
    # O cliente também manda nomes e preço, mas o servidor ignora e usa o catálogo.
    professional_id: str
    service_id: str
    date: date
    time: str = Field(pattern=r"^\d{2}:\d{2}$")


class BookingPatch(BaseModel):
    status: Literal["cancelled"]


class RescheduleIn(BaseModel):
    date: date
    time: str = Field(pattern=r"^\d{2}:\d{2}$")


class ProfessionalIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    specialty: str = Field(min_length=2, max_length=80)
    initials: str = Field(min_length=1, max_length=3)
    color: str = Field(default="#356859", pattern=r"^#[0-9a-fA-F]{6}$")


class ProfessionalPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=80)
    specialty: Optional[str] = Field(default=None, min_length=2, max_length=80)
    initials: Optional[str] = Field(default=None, min_length=1, max_length=3)
    color: Optional[str] = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    active: Optional[bool] = None


class ServiceIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    duration: int = Field(ge=10, le=240)
    price: float = Field(ge=0, le=10000)
    description: str = Field(default="", max_length=200)


class ServicePatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=80)
    duration: Optional[int] = Field(default=None, ge=10, le=240)
    price: Optional[float] = Field(default=None, ge=0, le=10000)
    description: Optional[str] = Field(default=None, max_length=200)
    active: Optional[bool] = None


HALF_HOUR = r"^([01]\d|2[0-3]):(00|30)$"


class Period(BaseModel):
    # Só horas cheias e meias: as travas de reserva usam blocos de 30 min.
    open: str = Field(pattern=HALF_HOUR)
    close: str = Field(pattern=HALF_HOUR)

    @model_validator(mode="after")
    def open_before_close(self):
        if to_minutes(self.open) >= to_minutes(self.close):
            raise ValueError("A abertura precisa ser antes do fechamento")
        return self


class HoursIn(BaseModel):
    weekdays: list[Optional[Period]] = Field(min_length=7, max_length=7)
    closed_dates: list[date] = Field(default_factory=list, max_length=366)

    @field_validator("closed_dates")
    @classmethod
    def unique_dates(cls, v):
        return sorted(set(v))


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
    set_session(response, user)
    return public_user(user)


@api.post("/auth/login")
async def login(body: LoginIn, request: Request, response: Response):
    email = body.email.lower()
    ip = client_ip(request)
    since = datetime.now(timezone.utc) - LOGIN_WINDOW
    recent = {"created_at": {"$gte": since}}
    per_account = await db.login_failures.count_documents({"ip": ip, "email": email, **recent})
    per_ip = await db.login_failures.count_documents({"ip": ip, **recent})
    per_email = await db.login_failures.count_documents({"email": email, **recent})
    if per_account >= LOGIN_MAX_PER_ACCOUNT or per_ip >= LOGIN_MAX_PER_IP or per_email >= LOGIN_MAX_PER_EMAIL:
        raise HTTPException(
            429, "Muitas tentativas de login. Aguarde 15 minutos e tente novamente.",
            headers={"Retry-After": str(int(LOGIN_WINDOW.total_seconds()))},
        )

    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not check_password(body.password, user["password_hash"]):
        await db.login_failures.insert_one({"ip": ip, "email": email, "created_at": datetime.now(timezone.utc)})
        raise HTTPException(401, "E-mail ou senha incorretos")
    await db.login_failures.delete_many({"ip": ip, "email": email})
    set_session(response, user)
    return public_user(user)


@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@api.get("/auth/me")
async def me(user: dict = Depends(current_user)):
    return public_user(user)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@api.post("/auth/forgot-password")
async def forgot_password(body: ForgotIn):
    # A resposta é sempre a mesma, exista ou não a conta, para não revelar
    # quais e-mails estão cadastrados.
    answer = {"message": "Se o e-mail estiver cadastrado, enviamos um link para criar uma nova senha."}
    user = await db.users.find_one({"email": body.email.lower()}, {"_id": 0})
    if not user:
        return answer
    now = datetime.now(timezone.utc)
    recent = await db.password_resets.count_documents(
        {"user_id": user["id"], "created_at": {"$gte": now - timedelta(hours=1)}}
    )
    if recent >= RESET_MAX_PER_HOUR:
        return answer

    token = secrets.token_urlsafe(32)
    await db.password_resets.insert_one({
        "token_hash": token_hash(token),  # só o hash vai para o banco
        "user_id": user["id"],
        "created_at": now,
        "expires_at": now + RESET_TTL,
    })
    link = f"{FRONTEND_URL}/redefinir-senha?token={token}"
    await send_email(
        user["email"],
        "Barbera: criar uma nova senha",
        f"Olá, {user['name'].split()[0]}.\n\n"
        f"Para criar uma nova senha, abra o link abaixo (vale por 1 hora):\n{link}\n\n"
        "Se você não pediu isso, ignore este e-mail; sua senha continua a mesma.",
    )
    return answer


@api.post("/auth/reset-password")
async def reset_password(body: ResetIn, response: Response):
    reset = await db.password_resets.find_one({"token_hash": token_hash(body.token)})
    expires_at = reset and reset["expires_at"]
    if expires_at and expires_at.tzinfo is None:  # o MongoDB devolve datas sem fuso (UTC)
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if not reset or expires_at < datetime.now(timezone.utc):
        raise HTTPException(400, "Link inválido ou expirado. Peça um novo.")
    user = await db.users.find_one_and_update(
        {"id": reset["user_id"]},
        {"$set": {"password_hash": hash_password(body.password)}, "$inc": {"session_version": 1}},
        projection={"_id": 0},
        return_document=True,
    )
    # O link vale uma vez só; os outros pedidos pendentes também deixam de valer.
    await db.password_resets.delete_many({"user_id": reset["user_id"]})
    await db.login_failures.delete_many({"email": user["email"]})
    set_session(response, user)
    return public_user(user)


# --------------------------------------------------------- catálogo e agenda

@api.get("/catalog")
async def catalog():
    professionals = await db.professionals.find(ACTIVE, {"_id": 0}).sort("name", 1).to_list(200)
    services = await db.services.find(ACTIVE, {"_id": 0}).sort("price", 1).to_list(200)
    return {"professionals": professionals, "services": services}


@api.get("/hours")
async def hours():
    return await get_hours()


async def free_slots(
    professional_id: str, day: date, duration: int, exclude_booking_id: Optional[str] = None
) -> list[str]:
    now = datetime.now(TZ)
    if day < now.date():
        return []
    opening = opening_for(await get_hours(), day)
    if not opening:
        return []
    open_minute, close_minute = opening

    busy = []
    async for b in db.bookings.find(
        {"professional_id": professional_id, "date": day.isoformat(), "status": "confirmed"},
        {"_id": 0, "id": 1, "time": 1, "duration": 1},
    ):
        if b["id"] == exclude_booking_id:
            continue
        start = to_minutes(b["time"])
        busy.append((start, start + b["duration"]))

    earliest = open_minute
    if day == now.date():
        earliest = max(earliest, now.hour * 60 + now.minute + 1)

    slots = []
    for start in range(open_minute, close_minute, SLOT_STEP):
        end = start + duration
        if start < earliest or end > close_minute:
            continue
        if any(start < b_end and b_start < end for b_start, b_end in busy):
            continue
        slots.append(fmt_minutes(start))
    return slots


@api.get("/slots")
async def slots(
    date: date, professional_id: str, service_id: Optional[str] = None, exclude: Optional[str] = None
):
    if not await db.professionals.find_one({"id": professional_id, **ACTIVE}):
        raise HTTPException(404, "Profissional não encontrado")
    duration = SLOT_STEP
    if service_id:
        service = await db.services.find_one({"id": service_id})
        if not service:
            raise HTTPException(404, "Serviço não encontrado")
        duration = service["duration"]
    return {"date": date.isoformat(), "slots": await free_slots(professional_id, date, duration, exclude)}


async def claim_blocks(locks: list[dict]) -> bool:
    """Grava as travas; se algum bloco já estiver ocupado, desfaz as gravadas e devolve False."""
    claimed = []
    try:
        for lock in locks:
            await db.slot_locks.insert_one(dict(lock))
            claimed.append(lock)
    except DuplicateKeyError:
        for lock in claimed:
            await db.slot_locks.delete_one({k: lock[k] for k in ("professional_id", "date", "block", "booking_id")})
        return False
    return True


@api.post("/bookings", status_code=201)
async def create_booking(body: BookingIn, user: dict = Depends(current_user)):
    professional = await db.professionals.find_one({"id": body.professional_id, **ACTIVE}, {"_id": 0})
    service = await db.services.find_one({"id": body.service_id, **ACTIVE}, {"_id": 0})
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
    # A checagem acima cobre o caso comum; as travas cobrem duas requisições
    # simultâneas que passaram pela checagem ao mesmo tempo.
    if not await claim_blocks(slot_locks_for(booking)):
        raise HTTPException(409, "Esse horário não está mais disponível")
    await db.bookings.insert_one(dict(booking))
    return booking


@api.get("/bookings")
async def my_bookings(user: dict = Depends(current_user)):
    return await db.bookings.find({"user_id": user["id"]}, {"_id": 0}).sort(
        [("date", -1), ("time", -1)]
    ).to_list(500)


async def find_own_booking(booking_id: str, user: dict) -> dict:
    booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not booking or (booking["user_id"] != user["id"] and user.get("role") != "admin"):
        raise HTTPException(404, "Reserva não encontrada")
    return booking


@api.patch("/bookings/{booking_id}")
async def update_booking(booking_id: str, body: BookingPatch, user: dict = Depends(current_user)):
    booking = await find_own_booking(booking_id, user)
    result = await db.bookings.update_one(
        {"id": booking_id, "status": "confirmed"}, {"$set": {"status": body.status}}
    )
    if result.modified_count == 0:
        raise HTTPException(409, "Essa reserva já foi cancelada")
    await db.slot_locks.delete_many({"booking_id": booking_id})
    booking["status"] = body.status
    return booking


@api.post("/bookings/{booking_id}/reschedule")
async def reschedule_booking(booking_id: str, body: RescheduleIn, user: dict = Depends(current_user)):
    """Muda data e horário mantendo profissional e serviço."""
    booking = await find_own_booking(booking_id, user)
    if booking["status"] != "confirmed":
        raise HTTPException(409, "Essa reserva já foi cancelada")
    # O próprio horário atual conta como livre: dá para empurrar 30 min para frente.
    if body.time not in await free_slots(booking["professional_id"], body.date, booking["duration"], booking_id):
        raise HTTPException(409, "Esse horário não está mais disponível")

    moved = {**booking, "date": body.date.isoformat(), "time": body.time}
    old = {(lock["date"], lock["block"]) for lock in slot_locks_for(booking)}
    new_locks = slot_locks_for(moved)
    # Blocos que a reserva já ocupa ficam; só os novos precisam ser travados.
    if not await claim_blocks([lock for lock in new_locks if (lock["date"], lock["block"]) not in old]):
        raise HTTPException(409, "Esse horário não está mais disponível")
    result = await db.bookings.update_one(
        {"id": booking_id, "status": "confirmed"},
        {"$set": {"date": moved["date"], "time": moved["time"], "rescheduled_at": now_iso()}},
    )
    keep = {(lock["date"], lock["block"]) for lock in new_locks}
    if result.modified_count == 0:
        # Cancelada no meio do caminho: devolve os blocos que acabou de travar.
        await db.slot_locks.delete_many({"booking_id": booking_id})
        raise HTTPException(409, "Essa reserva já foi cancelada")
    for day, block in old - keep:
        await db.slot_locks.delete_one({"booking_id": booking_id, "date": day, "block": block})
    return moved


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
            "professionals": await db.professionals.count_documents(ACTIVE),
            "revenue": sum(b["price"] for b in confirmed),
        },
        "bookings": bookings,
        "subscriptions": subscribers,
        # A equipe vê também os desativados, para poder reativar.
        "professionals": await db.professionals.find({}, {"_id": 0}).sort("name", 1).to_list(200),
        "services": await db.services.find({}, {"_id": 0}).sort("price", 1).to_list(200),
        "hours": await get_hours(),
    }


@api.post("/admin/professionals", status_code=201)
async def add_professional(body: ProfessionalIn, _: dict = Depends(admin_user)):
    prof = {"id": "p" + uuid.uuid4().hex[:8], **body.model_dump(), "active": True}
    prof["initials"] = prof["initials"].upper()
    await db.professionals.insert_one(dict(prof))
    return prof


async def patch_document(collection, doc_id: str, changes: dict, label: str) -> dict:
    if not changes:
        raise HTTPException(400, "Nada para alterar")
    doc = await collection.find_one_and_update(
        {"id": doc_id}, {"$set": changes}, projection={"_id": 0}, return_document=True
    )
    if not doc:
        raise HTTPException(404, f"{label} não encontrado")
    return doc


@api.patch("/admin/professionals/{professional_id}")
async def edit_professional(professional_id: str, body: ProfessionalPatch, _: dict = Depends(admin_user)):
    changes = body.model_dump(exclude_none=True)
    if "initials" in changes:
        changes["initials"] = changes["initials"].upper()
    # Reservas guardam uma cópia do nome, então o histórico fica como foi marcado.
    return await patch_document(db.professionals, professional_id, changes, "Profissional")


@api.post("/admin/services", status_code=201)
async def add_service(body: ServiceIn, _: dict = Depends(admin_user)):
    svc = {"id": "s" + uuid.uuid4().hex[:8], **body.model_dump(), "active": True}
    await db.services.insert_one(dict(svc))
    return svc


@api.patch("/admin/services/{service_id}")
async def edit_service(service_id: str, body: ServicePatch, _: dict = Depends(admin_user)):
    # Reservas já feitas guardam duração e preço da época; a mudança vale para as novas.
    return await patch_document(db.services, service_id, body.model_dump(exclude_none=True), "Serviço")


@api.put("/admin/hours")
async def set_hours(body: HoursIn, _: dict = Depends(admin_user)):
    doc = {
        "id": "hours",
        "weekdays": [p.model_dump() if p else None for p in body.weekdays],
        "closed_dates": [d.isoformat() for d in body.closed_dates],
    }
    await db.settings.replace_one({"id": "hours"}, doc, upsert=True)
    return await get_hours()


app.include_router(api)


# ------------------------------------------------------------- site (opcional)

if (STATIC_DIR / "index.html").exists():
    # Na imagem única o build do React fica em STATIC_DIR e a API serve o site:
    # mesma origem, sem CORS e sem nginx.
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        if path.startswith("api/"):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        file = (STATIC_DIR / path).resolve()
        if path and file.is_file() and file.is_relative_to(STATIC_DIR.resolve()):
            return FileResponse(file)
        return FileResponse(STATIC_DIR / "index.html")
