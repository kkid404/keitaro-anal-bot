FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1
ENV KEITARO_DASHBOARD_DB=/data/keitaro-dashboard.sqlite3
ENV PYTHONPATH=/app/src

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY src ./src
COPY static ./static

EXPOSE 8765

CMD ["python", "-m", "keitaro_dashboard", "serve", "--host", "0.0.0.0", "--port", "8765"]
