# Every gallery model lives in its own PostgreSQL instance (pgvector), never in
# the event database. photo_gallery.routers sends all ORM traffic here.
DB_ALIAS = "photos"
MODEL_VERSION = "yunet-2023mar-sface-2021dec-fp32-v1"
DIMENSIONS = 128
DETECTOR_NAME = "face_detection_yunet_2023mar.onnx"
RECOGNIZER_NAME = "face_recognition_sface_2021dec.onnx"
MODEL_HASHES = {
    DETECTOR_NAME: "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    RECOGNIZER_NAME: "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
}
