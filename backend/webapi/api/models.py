from __future__ import annotations

from django.db import models


class Account(models.Model):
    ROLE_ADMIN = "admin"
    ROLE_COLLAB = "collab"
    ROLE_CHOICES = [
        (ROLE_ADMIN, "Admin"),
        (ROLE_COLLAB, "Collaborator"),
    ]

    username = models.CharField(max_length=50, unique=True)
    email = models.EmailField(max_length=255, unique=True)
    password_hash = models.CharField(max_length=255)
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default=ROLE_COLLAB)
    is_active = models.BooleanField(default=True)
    token = models.CharField(max_length=128, null=True, blank=True, unique=True)
    last_login = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "account"

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.username} ({self.role})"

