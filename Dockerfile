FROM python:3.12-slim

# Install Node.js (for building the React frontend) + ffmpeg + ca-certificates
# + LibreOffice (full headless suite) + JRE + pandoc + poppler-utils (pdftoppm)
# for document conversion.
# libreoffice-writer/calc/impress/java-common + default-jre are all required for
# headless conversions; the plain `libreoffice` meta-package omits several of
# these components and causes "no export filter found" / javaldx JRE warnings.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg ca-certificates curl \
        libreoffice-writer libreoffice-calc libreoffice-impress \
        libreoffice-java-common default-jre \
        pandoc poppler-utils \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── 1. Build the React frontend ───────────────────────────────────────────────
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci --prefer-offline

COPY frontend/ ./frontend/
RUN cd frontend && npm run build
# The build output lands in /app/frontend_dist (per vite.config.js)

# ── 2. Install Python dependencies ───────────────────────────────────────────
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── 3. Copy application source ────────────────────────────────────────────────
COPY . .

# Create data directory for persistent files (cookies, etc.)
# Also create a writable home directory for LibreOffice's user profile cache;
# headless LibreOffice will fail with "no export filter found" if it cannot
# write its profile directory.
RUN mkdir -p /app/data /home/appuser && chmod 777 /home/appuser

# Railway injects PORT at runtime; default to 5000 for local use
ENV PORT=5000

# Ensure LibreOffice can always write its user-profile directory.
ENV HOME=/home/appuser

# Point Python's SSL and requests libraries at the system CA bundle
# so yt-dlp subprocesses can verify TLS connections successfully.
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
ENV REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt

EXPOSE 5000

CMD ["sh", "-c", "uvicorn api.app:app --host 0.0.0.0 --port $PORT --workers 1"]
