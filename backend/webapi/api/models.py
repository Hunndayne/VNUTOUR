from __future__ import annotations

from django.db import models


class Account(models.Model):
    ROLE_ADMIN = "admin"
    ROLE_COLLAB = "collab"
    ROLE_MEMBER = "member"  # self-registered participant; becomes "captain" when owning a team
    ROLE_CHOICES = [
        (ROLE_ADMIN, "Admin"),
        (ROLE_COLLAB, "Collaborator"),
        (ROLE_MEMBER, "Member"),
    ]

    username = models.CharField(max_length=50, unique=True)
    email = models.EmailField(max_length=255, unique=True)
    password_hash = models.CharField(max_length=255)
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default=ROLE_COLLAB)
    is_active = models.BooleanField(default=True)
    token = models.CharField(max_length=128, null=True, blank=True, unique=True)
    # Member profile linkage (used for auto-fill & "has account" detection)
    mssv = models.CharField(max_length=20, null=True, blank=True, unique=True)
    full_name = models.CharField(max_length=255, null=True, blank=True)
    # For the team owner (captain): hex string of the MongoDB ObjectId of the team they own
    team_oid = models.CharField(max_length=24, null=True, blank=True)
    last_login = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    @property
    def is_captain(self) -> bool:
        return bool(self.team_oid)

    class Meta:
        db_table = "account"

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.username} ({self.role})"

