"""Heavy dependencies imported only in photo-ai containers, never the web app."""
import hashlib
import threading
from functools import lru_cache
from pathlib import Path

from django.conf import settings

from .constants import DETECTOR_NAME, RECOGNIZER_NAME, MODEL_HASHES, DIMENSIONS, MODEL_VERSION
from .errors import GalleryError

MAX_FACES = 256
MAX_CANDIDATES = 2048


def _sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class FaceEngine:
    def __init__(self):
        try:
            import cv2
            import numpy as np

            self.cv, self.np = cv2, np
            root = Path(settings.PHOTO_AI_MODEL_DIR)
            for name, expected in MODEL_HASHES.items():
                path = root / name
                if not path.is_file() or _sha256(path) != expected:
                    raise GalleryError("model_unavailable")
            cv2.setNumThreads(max(1, min(32, int(settings.PHOTO_AI_THREADS))))
            self.detector = cv2.FaceDetectorYN.create(
                str(root / DETECTOR_NAME), "", (320, 320), 0.9, 0.3, MAX_CANDIDATES,
            )
            self.recognizer = cv2.FaceRecognizerSF.create(str(root / RECOGNIZER_NAME), "")
            # Fail readiness if the recognizer artifact does not match the DB
            # vector schema associated with MODEL_VERSION.
            probe = np.zeros((112, 112, 3), dtype=np.uint8)
            feature = self.recognizer.feature(probe)
            if feature is None or feature.size != DIMENSIONS or not np.isfinite(feature).all():
                raise GalleryError("model_unavailable")
        except GalleryError:
            raise
        except (ImportError, OSError, TypeError, ValueError) as exc:
            raise GalleryError("model_unavailable") from exc
        except Exception as exc:
            # OpenCV exposes native initialization failures as cv2.error, but
            # importing that type safely requires cv2 to have loaded first.
            raise GalleryError("model_unavailable") from exc
        self.model_version = MODEL_VERSION
        self.lock = threading.Lock()

    def extract(self, image, *, reference=False, heartbeat=None):
        if not self.lock.acquire(blocking=False):
            raise GalleryError("search_unavailable", retryable=True)
        try:
            return self._extract(image, reference=reference, heartbeat=heartbeat)
        except GalleryError:
            raise
        except self.cv.error as exc:
            raise GalleryError("model_unavailable", retryable=True) from exc
        finally:
            self.lock.release()

    def _extract(self, image, *, reference, heartbeat):
        cv, np = self.cv, self.np
        resized = image.copy()
        edge = 1600 if reference else 4096
        resized.thumbnail((edge, edge))
        pixels = cv.cvtColor(np.asarray(resized), cv.COLOR_RGB2BGR)
        height, width = pixels.shape[:2]
        candidates = []
        # Tile album photos to retain small faces; whole-frame pass catches faces
        # crossing tile boundaries. A fixed cap bounds work per image.
        regions = [(0, 0, width, height)]
        if not reference and max(width, height) > 1600:
            regions += [(x, y, min(1024, width - x), min(1024, height - y))
                        for y in range(0, height, 896) for x in range(0, width, 896)]
        for x, y, w, h in regions:
            if heartbeat:
                heartbeat()
            if min(w, h) < 32:
                continue
            crop = pixels[y:y+h, x:x+w]
            scale = min(1.0, 1600 / max(w, h))
            if scale < 1:
                crop = cv.resize(crop, (round(w * scale), round(h * scale)))
            self.detector.setInputSize((crop.shape[1], crop.shape[0]))
            _, faces = self.detector.detect(crop)
            if faces is None:
                continue
            for face in faces:
                face = face.copy()
                face[:14] /= scale
                face[0] += x
                face[1] += y
                face[4:14:2] += x
                face[5:14:2] += y
                candidates.append(face)
                if len(candidates) > MAX_CANDIDATES:
                    raise GalleryError("too_many_faces")
        if not candidates:
            if reference:
                raise GalleryError("no_face")
            return []
        keep = cv.dnn.NMSBoxes([f[:4].tolist() for f in candidates], [float(f[-1]) for f in candidates], 0.9, 0.3)
        selected = [candidates[int(i)] for i in np.asarray(keep).flatten()]
        if reference and len(selected) != 1:
            raise GalleryError("multiple_faces")
        if len(selected) > MAX_FACES:
            raise GalleryError("too_many_faces")
        result = []
        for face in selected:
            if heartbeat:
                heartbeat()
            aligned = self.recognizer.alignCrop(pixels, face)
            vector = self.recognizer.feature(aligned).reshape(-1).astype(np.float32)
            norm = np.linalg.norm(vector)
            if len(vector) != DIMENSIONS or not np.isfinite(vector).all() or norm <= 0:
                raise GalleryError("model_unavailable")
            vector /= norm
            left = max(0.0, min(float(width), float(face[0])))
            top = max(0.0, min(float(height), float(face[1])))
            right = max(left, min(float(width), float(face[0] + face[2])))
            bottom = max(top, min(float(height), float(face[1] + face[3])))
            result.append({"bbox": [left / width, top / height, (right - left) / width, (bottom - top) / height],
                           "embedding": vector.tolist()})
        return result


@lru_cache(maxsize=1)
def get_engine():
    return FaceEngine()
