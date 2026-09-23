# Photo AI model notices

The production image contains these unmodified OpenCV Zoo model artifacts.
The downloader records and verifies the upstream URL and exact SHA256 before a
model is placed in `/models`.

| Artifact | Upstream license | Source |
| --- | --- | --- |
| `face_detection_yunet_2023mar.onnx` | MIT | [OpenCV Zoo YuNet README](https://github.com/opencv/opencv_zoo/blob/main/models/face_detection_yunet/README.md) |
| `face_recognition_sface_2021dec.onnx` | Apache-2.0 | [OpenCV Zoo SFace README](https://github.com/opencv/opencv_zoo/blob/main/models/face_recognition_sface/README.md) |

The upstream READMEs identify these directory licenses. Their full texts are
included here as `YUNET_LICENSE` and `SFACE_LICENSE`; retain them with every
image or model artifact redistribution. Model accuracy and suitability for
this event still require evaluation on a representative image set.

The image build fetches only these fixed HTTPS URLs:

- `https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx`
- `https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx`
