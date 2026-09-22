"""Keep the gallery in its own database and everything else out of it.

The gallery only reads Account/TeamMembership through separate queries on the
default database for access checks; no query or foreign key crosses databases.
"""
from .constants import DB_ALIAS

APP_LABEL = "photo_gallery"


class PhotoGalleryRouter:
    def db_for_read(self, model, **hints):
        return DB_ALIAS if model._meta.app_label == APP_LABEL else None

    def db_for_write(self, model, **hints):
        return DB_ALIAS if model._meta.app_label == APP_LABEL else None

    def allow_relation(self, obj1, obj2, **hints):
        first = obj1._meta.app_label == APP_LABEL
        second = obj2._meta.app_label == APP_LABEL
        return True if first and second else (False if first or second else None)

    def allow_migrate(self, db, app_label, **hints):
        if app_label == APP_LABEL:
            return db == DB_ALIAS
        # No other app (auth, contenttypes, api...) may create tables there.
        return False if db == DB_ALIAS else None
