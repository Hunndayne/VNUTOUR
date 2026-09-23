class GalleryError(Exception):
    def __init__(self, code, *, retryable=False):
        super().__init__(code)
        self.code = code
        self.retryable = retryable


class LeaseLost(Exception):
    """The database fencing token no longer belongs to this worker."""


class WorkerStopping(Exception):
    """Cooperative cancellation used for a bounded worker shutdown."""
