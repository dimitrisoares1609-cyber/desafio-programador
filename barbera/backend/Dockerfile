FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py .
EXPOSE 8001
# A API só é alcançável pelo nginx do compose (sem porta publicada), então dá
# para confiar no X-Forwarded-For dele: é o que dá o IP real ao limite de login.
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8001", "--proxy-headers", "--forwarded-allow-ips", "*"]
