import io
import warnings

from django.conf import settings
from PIL import Image, ImageOps, UnidentifiedImageError

from .errors import GalleryError


def read_image(source):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(source) as original:
                if original.format not in {"JPEG", "PNG", "WEBP"}:
                    raise GalleryError("invalid_image")
                if original.width <= 0 or original.height <= 0:
                    raise GalleryError("invalid_image")
                if original.width * original.height > settings.PHOTO_MAX_PIXELS:
                    raise GalleryError("too_many_pixels")
                original.load()
                return ImageOps.exif_transpose(original).convert("RGB")
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise GalleryError("too_many_pixels") from exc
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise GalleryError("invalid_image") from exc


def preview(image, edge):
    if edge <= 0:
        raise ValueError("preview edge must be positive")
    result = image.copy()
    result.thumbnail((edge, edge), Image.Resampling.LANCZOS)
    stream = io.BytesIO()
    # New encoding intentionally excludes EXIF and location metadata.
    result.save(stream, "WEBP", quality=82, method=4)
    return stream.getvalue()
