"""Reference-image embedding and exact, privacy-preserving photo search."""
from __future__ import annotations

import math
from collections import defaultdict

import requests
from django.conf import settings
from django.db import connections
from django.db.models import Min

from .constants import DB_ALIAS, DIMENSIONS, MODEL_VERSION
from .errors import GalleryError
from .models import Face


def embed_reference(image_bytes: bytes) -> list[float]:
    """Ask the internal model service for one normalized reference vector."""
    if not settings.PHOTO_SEARCH_ENABLED or not settings.PHOTO_AI_TOKEN:
        raise GalleryError("search_unavailable", retryable=True)
    try:
        response = requests.post(
            f"{settings.PHOTO_AI_URL}/v1/embed",
            data=image_bytes,
            headers={"Authorization": f"Bearer {settings.PHOTO_AI_TOKEN}", "Content-Type": "application/octet-stream"},
            timeout=(5, settings.PHOTO_SEARCH_TIMEOUT_SECONDS),
        )
    except requests.RequestException as exc:
        raise GalleryError("search_unavailable", retryable=True) from exc
    try:
        payload = response.json()
    except ValueError as exc:
        raise GalleryError("search_unavailable", retryable=True) from exc
    if response.status_code >= 500:
        raise GalleryError("search_unavailable", retryable=True)
    if not isinstance(payload, dict):
        raise GalleryError("search_unavailable", retryable=True)
    code = payload.get("error")
    if response.status_code >= 400 or code:
        if code in {"invalid_image", "reference_too_large", "too_many_pixels", "no_face", "multiple_faces"}:
            raise GalleryError(code)
        raise GalleryError("search_unavailable", retryable=True)
    if payload.get("model_version") != MODEL_VERSION:
        raise GalleryError("search_unavailable", retryable=True)
    embedding = payload.get("embedding")
    if not isinstance(embedding, list) or len(embedding) != DIMENSIONS:
        raise GalleryError("search_unavailable", retryable=True)
    try:
        vector = [float(value) for value in embedding]
    except (TypeError, ValueError) as exc:
        raise GalleryError("search_unavailable", retryable=True) from exc
    norm = math.sqrt(sum(value * value for value in vector))
    if not all(math.isfinite(value) for value in vector) or not math.isfinite(norm) or abs(norm - 1.0) > 1e-3:
        raise GalleryError("search_unavailable", retryable=True)
    return vector


def _base_faces(*, album_id: int | None):
    query = Face.objects.filter(
        photo__status="ready",
        photo__album__status="published",
        photo__model_version=MODEL_VERSION,
        model_version=MODEL_VERSION,
    )
    if album_id is not None:
        query = query.filter(photo__album_id=album_id)
    return query


def _sqlite_results(vector: list[float], *, album_id: int | None, maximum: int):
    """Portable exact fallback used only by SQLite tests and local checks."""
    best = defaultdict(lambda: float("inf"))
    for face in _base_faces(album_id=album_id).only("photo_id", "embedding"):
        try:
            values = [float(value) for value in face.embedding]
        except (TypeError, ValueError):
            continue
        if len(values) != DIMENSIONS or not all(math.isfinite(value) for value in values):
            continue
        distance = 1.0 - sum(left * right for left, right in zip(values, vector))
        best[face.photo_id] = min(best[face.photo_id], distance)
    cutoff = 1.0 - settings.PHOTO_SEARCH_THRESHOLD
    pairs = sorted((distance, photo_id) for photo_id, distance in best.items() if distance <= cutoff)
    return [photo_id for _distance, photo_id in pairs[:maximum]], len(pairs) > maximum


def matching_photo_ids(vector: list[float], *, album_id: int | None) -> tuple[list[int], bool]:
    """Return at most 500 ranked IDs, aggregating every face before limiting.

    PostgreSQL keeps this entirely in SQL: Min(CosineDistance) groups all faces
    belonging to a photo before the 501-row cap determines truncation.
    """
    maximum = 500
    if connections[DB_ALIAS].vendor != "postgresql":
        return _sqlite_results(vector, album_id=album_id, maximum=maximum)
    from pgvector.django import CosineDistance

    cutoff = 1.0 - settings.PHOTO_SEARCH_THRESHOLD
    rows = (
        _base_faces(album_id=album_id)
        .values("photo_id")
        .annotate(distance=Min(CosineDistance("embedding", vector)))
        .filter(distance__lte=cutoff)
        .order_by("distance", "photo_id")[: maximum + 1]
    )
    rows = list(rows)
    return [row["photo_id"] for row in rows[:maximum]], len(rows) > maximum
