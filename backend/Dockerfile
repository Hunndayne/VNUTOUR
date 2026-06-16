FROM python:3.11-slim

# Runtime env
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=UTF-8 \
    LANG=C.UTF-8

WORKDIR /app

# System deps: ffmpeg for audio; clean up apt lists to keep image small
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ffmpeg \
       libopus0 \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps first (better layer caching)
COPY requirements.txt ./
RUN pip install --no-cache-dir -U pip setuptools wheel \
    && pip install --no-cache-dir -r requirements.txt

# Copy app source
COPY . .

# Default to running the bot
CMD ["python", "main.py"]
