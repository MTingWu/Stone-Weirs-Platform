FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

ENV PORT=5000
EXPOSE 5000

# 這個後端沒有存在記憶體的狀態，所以可以放心開多個 worker
CMD gunicorn app:app --bind 0.0.0.0:${PORT} --workers 2 --timeout 60
