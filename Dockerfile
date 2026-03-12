FROM python:3.12-slim

# Install ffmpeg (required by yt-dlp for merging formats)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source
COPY . .

# Create data directory for persistent files (cookies, etc.)
RUN mkdir -p /app/data

# Railway injects PORT at runtime; default to 5000 for local use
ENV PORT=5000

# Point Python's SSL and requests libraries at the system CA bundle
# so yt-dlp subprocesses can verify TLS connections successfully.
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
ENV REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt

EXPOSE 5000

CMD ["sh", "-c", "uvicorn api.app:app --host 0.0.0.0 --port $PORT --workers 1"]
