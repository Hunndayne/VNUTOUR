"""Fetch and verify the OpenCV Zoo models used by the photo worker.

The image build is the only supported place to download these artifacts.  A
model that is already present is accepted only when its exact SHA256 matches;
this prevents a partial download or an upstream replacement from silently
entering a runtime image.
"""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import tempfile
from urllib.request import Request, urlopen


MODELS = (
    {
        "name": "face_detection_yunet_2023mar.onnx",
        "url": (
            "https://media.githubusercontent.com/media/opencv/opencv_zoo/"
            "main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
        ),
        "sha256": "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    },
    {
        "name": "face_recognition_sface_2021dec.onnx",
        "url": (
            "https://media.githubusercontent.com/media/opencv/opencv_zoo/"
            "main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"
        ),
        "sha256": "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
    },
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fetch_model(spec: dict[str, str], output: Path) -> None:
    destination = output / spec["name"]
    if destination.is_file():
        actual = sha256(destination)
        if actual != spec["sha256"]:
            raise SystemExit(
                f"Refusing mismatched existing model {destination}: "
                f"expected {spec['sha256']}, got {actual}"
            )
        print(f"verified {destination}")
        return

    request = Request(spec["url"], headers={"User-Agent": "vnutour-photo-ai-model-fetch/1"})
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=output, prefix=f".{spec['name']}.", delete=False) as stream:
            temporary = Path(stream.name)
            with urlopen(request, timeout=120) as response:  # nosec B310: fixed HTTPS URLs above
                for chunk in iter(lambda: response.read(1024 * 1024), b""):
                    stream.write(chunk)
            stream.flush()
            os.fsync(stream.fileno())
    except Exception:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
        raise

    actual = sha256(temporary)
    if actual != spec["sha256"]:
        temporary.unlink(missing_ok=True)
        raise SystemExit(
            f"SHA256 mismatch for {spec['name']}: expected {spec['sha256']}, got {actual}"
        )
    os.replace(temporary, destination)
    print(f"downloaded and verified {destination}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("/models"))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    for spec in MODELS:
        fetch_model(spec, args.output)


if __name__ == "__main__":
    main()
