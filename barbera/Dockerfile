# Imagem única: o build do React vai para dentro da API, que serve site e /api
# na mesma origem (sem CORS e sem nginx). É a imagem usada no compose e no Render.
FROM node:22-alpine AS site
WORKDIR /site
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/server.py .
COPY --from=site /site/dist ./static
ENV PORT=8000
EXPOSE 8000
# O IP do visitante é resolvido pela própria API (TRUSTED_PROXY_HOPS), então o
# uvicorn não reescreve nada a partir do X-Forwarded-For.
CMD ["sh", "-c", "exec uvicorn server:app --host 0.0.0.0 --port ${PORT} --no-proxy-headers"]
