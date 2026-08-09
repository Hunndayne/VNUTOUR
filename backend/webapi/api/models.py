from __future__ import annotations

from django.db import models
from django.utils import timezone


# =====================================================================
# 1. Account (extended from existing)
# =====================================================================

class Account(models.Model):
    ROLE_PARTICIPANT = "participant"
    ROLE_COLLAB = "collab"
    ROLE_ADMIN = "admin"
    # Everything an admin may do, plus sole authority over the shape of the
    # programme: which phase is current, the phase calendar, sub-events and
    # stations. Kept separate so a mis-click by an operating admin cannot move
    # the whole event to another phase mid-run.
    ROLE_MASTER_ADMIN = "master_admin"
    ROLE_CHOICES = [
        (ROLE_PARTICIPANT, "Participant"),
        (ROLE_COLLAB, "Collaborator"),
        (ROLE_ADMIN, "Admin"),
        (ROLE_MASTER_ADMIN, "Master Admin"),
    ]

    username = models.CharField(max_length=50, unique=True)
    email = models.EmailField(max_length=255, unique=True)
    password_hash = models.CharField(max_length=255)
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default=ROLE_PARTICIPANT)
    is_active = models.BooleanField(default=True)
    token = models.CharField(max_length=128, null=True, blank=True, unique=True)
    token_created_at = models.DateTimeField(null=True, blank=True)
    mssv = models.CharField(max_length=20, null=True, blank=True, unique=True)
    full_name = models.CharField(max_length=255, null=True, blank=True)
    phone = models.CharField(max_length=20, null=True, blank=True)
    school = models.CharField(max_length=255, null=True, blank=True)
    faculty = models.CharField(max_length=255, null=True, blank=True)
    avatar = models.CharField(max_length=500, null=True, blank=True)
    google_sub = models.CharField(max_length=255, null=True, blank=True, unique=True)
    last_login = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "account"

    def __str__(self) -> str:
        return f"{self.username} ({self.role})"


# =====================================================================
# 2. Participant
# =====================================================================

class Participant(models.Model):
    account = models.OneToOneField(
        Account, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="participant_profile",
    )
    mssv = models.CharField(max_length=20, unique=True)
    full_name = models.CharField(max_length=255)
    email = models.EmailField(max_length=255, null=True, blank=True)
    phone = models.CharField(max_length=20, null=True, blank=True)
    faculty = models.CharField(max_length=255, null=True, blank=True)
    school = models.CharField(max_length=255, null=True, blank=True)
    facebook = models.CharField(max_length=255, null=True, blank=True)
    cccd = models.CharField(max_length=20, null=True, blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    # Admin-defined fields that are not first-class columns live here.
    extra = models.JSONField(null=True, blank=True)
    discord_id = models.BigIntegerField(null=True, blank=True, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "participant"

    def __str__(self) -> str:
        return f"{self.mssv} - {self.full_name}"


# =====================================================================
# 3. Team
# =====================================================================

class Team(models.Model):
    APPROVAL_DRAFT = "draft"
    APPROVAL_PENDING = "pending_approval"
    APPROVAL_APPROVED = "approved"
    APPROVAL_REJECTED = "rejected"
    APPROVAL_CHOICES = [
        (APPROVAL_DRAFT, "Draft"),
        (APPROVAL_PENDING, "Pending Approval"),
        (APPROVAL_APPROVED, "Approved"),
        (APPROVAL_REJECTED, "Rejected"),
    ]

    PROVISION_NONE = "none"
    PROVISION_PENDING = "pending"
    PROVISION_DONE = "done"
    PROVISION_FAILED = "failed"
    PROVISION_CHOICES = [
        (PROVISION_NONE, "None"),
        (PROVISION_PENDING, "Pending"),
        (PROVISION_DONE, "Done"),
        (PROVISION_FAILED, "Failed"),
    ]

    code = models.CharField(max_length=10, unique=True, help_text="e.g. T0001")
    name = models.CharField(max_length=255)
    owner_account = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="owned_teams",
    )
    approval_status = models.CharField(
        max_length=20, choices=APPROVAL_CHOICES, default=APPROVAL_DRAFT,
    )
    approval_note = models.TextField(null=True, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="reviewed_teams",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    qr_token = models.CharField(max_length=64, unique=True, null=True, blank=True)
    payment_proof = models.CharField(max_length=500, null=True, blank=True)
    provision_state = models.CharField(
        max_length=10, choices=PROVISION_CHOICES, default=PROVISION_NONE,
    )
    provision_last_error = models.TextField(null=True, blank=True)
    provision_retry_count = models.IntegerField(default=0)
    last_provisioned_at = models.DateTimeField(null=True, blank=True)
    discord_role_id = models.BigIntegerField(null=True, blank=True)
    text_channel_id = models.BigIntegerField(null=True, blank=True)
    voice_channel_id = models.BigIntegerField(null=True, blank=True)
    is_late_registration = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "team"

    def __str__(self) -> str:
        return f"{self.code} - {self.name}"


# =====================================================================
# 4. TeamMembership
# =====================================================================

class TeamMembership(models.Model):
    team = models.ForeignKey(
        Team, on_delete=models.CASCADE, related_name="memberships",
    )
    participant = models.ForeignKey(
        Participant, on_delete=models.CASCADE, related_name="memberships",
    )
    is_captain = models.BooleanField(default=False)
    team_number = models.IntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "team_membership"
        constraints = [
            models.UniqueConstraint(
                fields=["team", "participant"],
                name="uq_membership_team_participant",
            ),
            # One participant can only be in one team
            models.UniqueConstraint(
                fields=["participant"],
                name="uq_membership_participant",
            ),
            models.UniqueConstraint(
                fields=["team"],
                condition=models.Q(is_captain=True),
                name="uq_membership_one_captain_per_team",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.team.code} <- {self.participant.mssv}"


# =====================================================================
# 5. ProgramPhase
# =====================================================================

class ProgramPhase(models.Model):
    key = models.CharField(max_length=20, unique=True)
    label = models.CharField(max_length=100)
    hint = models.TextField(null=True, blank=True)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    order = models.IntegerField(default=0)
    is_current = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "program_phase"
        ordering = ["order"]
        constraints = [
            models.UniqueConstraint(
                fields=["is_current"],
                condition=models.Q(is_current=True),
                name="uq_program_phase_single_current",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.key} ({self.label})"


# =====================================================================
# 6. SubEvent
# =====================================================================

class SubEvent(models.Model):
    TYPE_WORKFLOW = "workflow"
    TYPE_SOCIAL = "social"
    TYPE_STATION_RUN = "station_run"
    TYPE_QUIZ = "quiz"
    TYPE_SUBMISSION = "submission"
    TYPE_CUSTOM = "custom"
    TYPE_CHOICES = [
        (TYPE_WORKFLOW, "Workflow"),
        (TYPE_SOCIAL, "Social"),
        (TYPE_STATION_RUN, "Station Run"),
        (TYPE_QUIZ, "Quiz"),
        (TYPE_SUBMISSION, "Submission"),
        (TYPE_CUSTOM, "Custom"),
    ]

    phase = models.ForeignKey(
        ProgramPhase, on_delete=models.CASCADE, related_name="sub_events",
    )
    name = models.CharField(max_length=255)
    type = models.CharField(max_length=20, choices=TYPE_CHOICES, default=TYPE_CUSTOM)
    start_date = models.DateTimeField(null=True, blank=True)
    end_date = models.DateTimeField(null=True, blank=True)
    uses_stations = models.BooleanField(default=False)
    note = models.TextField(null=True, blank=True)
    order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sub_event"
        ordering = ["phase", "order"]

    def __str__(self) -> str:
        return f"{self.name} ({self.phase.key})"


# =====================================================================
# 7. PhaseRoster
# =====================================================================

class PhaseRoster(models.Model):
    ORIGIN_APPROVED = "approved"
    ORIGIN_QUALIFIED = "qualified"
    ORIGIN_WILDCARD = "wildcard"
    ORIGIN_MANUAL = "manual"
    ORIGIN_CHOICES = [
        (ORIGIN_APPROVED, "Approved"),
        (ORIGIN_QUALIFIED, "Qualified"),
        (ORIGIN_WILDCARD, "Wildcard"),
        (ORIGIN_MANUAL, "Manual"),
    ]

    phase = models.ForeignKey(
        ProgramPhase, on_delete=models.CASCADE, related_name="roster",
    )
    team = models.ForeignKey(
        Team, on_delete=models.CASCADE, related_name="phase_rosters",
    )
    origin = models.CharField(max_length=20, choices=ORIGIN_CHOICES, default=ORIGIN_APPROVED)
    qualified_from_phase = models.ForeignKey(
        ProgramPhase, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="promoted_to",
    )
    note = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "phase_roster"
        constraints = [
            models.UniqueConstraint(
                fields=["phase", "team"], name="uq_roster_phase_team",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.team.code} in {self.phase.key}"


# =====================================================================
# 8. Station
# =====================================================================

class Station(models.Model):
    POLICY_STAFF_SCAN = "staff_scan"
    POLICY_FREE_PLAY = "free_play"
    POLICY_CHOICES = [
        (POLICY_STAFF_SCAN, "Staff Scan"),
        (POLICY_FREE_PLAY, "Free Play"),
    ]

    CAPACITY_UNLIMITED = "unlimited"
    CAPACITY_LIMITED = "limited"
    CAPACITY_CHOICES = [
        (CAPACITY_UNLIMITED, "Unlimited"),
        (CAPACITY_LIMITED, "Limited"),
    ]

    sub_event = models.ForeignKey(
        SubEvent, on_delete=models.CASCADE, related_name="stations",
    )
    code = models.CharField(max_length=50)
    name = models.CharField(max_length=255)
    location = models.CharField(max_length=255, null=True, blank=True)
    order = models.IntegerField(default=0)
    active = models.BooleanField(default=True)
    checkin_policy = models.CharField(
        max_length=20, choices=POLICY_CHOICES, default=POLICY_STAFF_SCAN,
    )
    capacity_mode = models.CharField(
        max_length=20, choices=CAPACITY_CHOICES, default=CAPACITY_UNLIMITED,
    )
    max_concurrent_teams = models.IntegerField(null=True, blank=True)
    submission_config = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "station"
        constraints = [
            models.UniqueConstraint(
                fields=["sub_event", "code"], name="uq_station_event_code",
            ),
        ]
        ordering = ["sub_event", "order"]

    def __str__(self) -> str:
        return f"{self.code} - {self.name}"


# =====================================================================
# 9. StationAssignment
# =====================================================================

class StationAssignment(models.Model):
    collab = models.ForeignKey(
        Account, on_delete=models.CASCADE, related_name="station_assignments",
    )
    station = models.ForeignKey(
        Station, on_delete=models.CASCADE, related_name="assignments",
    )
    shift_start = models.DateTimeField(null=True, blank=True)
    shift_end = models.DateTimeField(null=True, blank=True)
    note = models.TextField(null=True, blank=True)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "station_assignment"
        ordering = ["station__sub_event", "station__order", "collab__username"]
        constraints = [
            models.UniqueConstraint(
                fields=["collab", "station"], name="uq_assignment_collab_station",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.collab.username} -> {self.station.code}"


# =====================================================================
# 10. EventCheckIn
# =====================================================================

class EventCheckIn(models.Model):
    STATUS_ACTIVE = "active"
    STATUS_REVERTED = "reverted"
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_REVERTED, "Reverted"),
    ]

    phase = models.ForeignKey(
        ProgramPhase, on_delete=models.CASCADE, related_name="event_checkins",
    )
    sub_event = models.ForeignKey(
        SubEvent, on_delete=models.CASCADE, related_name="event_checkins",
    )
    team = models.ForeignKey(
        Team, on_delete=models.CASCADE, related_name="event_checkins",
    )
    scanner = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="scanned_checkins",
    )
    status = models.CharField(
        max_length=10, choices=STATUS_CHOICES, default=STATUS_ACTIVE,
    )
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(null=True, blank=True)
    meta = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "event_checkin"
        constraints = [
            models.UniqueConstraint(
                fields=["sub_event", "team"],
                condition=models.Q(status="active"),
                name="uq_active_checkin_event_team",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.team.code} @ {self.sub_event.name} ({self.status})"


# =====================================================================
# 11. StationSession
# =====================================================================

class StationSession(models.Model):
    STATUS_ACTIVE = "active"
    STATUS_CLOSED = "closed"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_CLOSED, "Closed"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    phase = models.ForeignKey(
        ProgramPhase, on_delete=models.CASCADE, related_name="station_sessions",
    )
    sub_event = models.ForeignKey(
        SubEvent, on_delete=models.CASCADE, related_name="station_sessions",
    )
    station = models.ForeignKey(
        Station, on_delete=models.CASCADE, related_name="sessions",
    )
    team = models.ForeignKey(
        Team, on_delete=models.CASCADE, related_name="station_sessions",
    )
    status = models.CharField(
        max_length=10, choices=STATUS_CHOICES, default=STATUS_ACTIVE,
    )
    entered_at = models.DateTimeField()
    entered_by = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="entered_sessions",
    )
    exited_at = models.DateTimeField(null=True, blank=True)
    exited_by = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="exited_sessions",
    )
    score = models.IntegerField(default=0)
    note = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "station_session"
        constraints = [
            # One active session per station per team
            models.UniqueConstraint(
                fields=["station", "team"],
                condition=models.Q(status="active"),
                name="uq_active_session_station_team",
            ),
            # One active session per event per team (prevents same team at 2 stations simultaneously)
            models.UniqueConstraint(
                fields=["sub_event", "team"],
                condition=models.Q(status="active"),
                name="uq_active_session_event_team",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.team.code} @ {self.station.code} ({self.status})"


# =====================================================================
# 12. ScoreEntry
# =====================================================================

class ScoreEntry(models.Model):
    KIND_STATION = "station"
    KIND_BONUS = "bonus"
    KIND_PENALTY = "penalty"
    KIND_MANUAL = "manual"
    KIND_CHOICES = [
        (KIND_STATION, "Station"),
        (KIND_BONUS, "Bonus"),
        (KIND_PENALTY, "Penalty"),
        (KIND_MANUAL, "Manual"),
    ]

    phase = models.ForeignKey(
        ProgramPhase, on_delete=models.CASCADE, related_name="score_entries",
    )
    sub_event = models.ForeignKey(
        SubEvent, on_delete=models.CASCADE, related_name="score_entries",
    )
    station_session = models.ForeignKey(
        StationSession, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="score_entries",
    )
    submission = models.ForeignKey(
        "StationSubmission", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="score_entries",
    )
    team = models.ForeignKey(
        Team, on_delete=models.CASCADE, related_name="score_entries",
    )
    kind = models.CharField(max_length=10, choices=KIND_CHOICES)
    points = models.IntegerField()
    note = models.TextField(null=True, blank=True)
    created_by = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="created_score_entries",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "score_entry"
        constraints = [
            models.UniqueConstraint(
                fields=["station_session", "kind"],
                condition=models.Q(
                    station_session__isnull=False,
                    kind="station",
                ),
                name="uq_station_score_per_session",
            ),
            models.UniqueConstraint(
                fields=["submission", "kind"],
                condition=models.Q(
                    submission__isnull=False,
                    kind="station",
                ),
                name="uq_station_score_per_submission",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.team.code} {self.kind}: {self.points:+d}"


# =====================================================================
# 13. AdvancementRule
# =====================================================================

class AdvancementRule(models.Model):
    MODE_TOP_N = "top_n"
    MODE_MANUAL = "manual"
    MODE_CHOICES = [
        (MODE_TOP_N, "Top N"),
        (MODE_MANUAL, "Manual"),
    ]

    from_phase = models.ForeignKey(
        ProgramPhase, on_delete=models.CASCADE, related_name="advancement_from",
    )
    to_phase = models.ForeignKey(
        ProgramPhase, on_delete=models.CASCADE, related_name="advancement_to",
    )
    mode = models.CharField(max_length=10, choices=MODE_CHOICES, default=MODE_TOP_N)
    slots = models.IntegerField(default=0)
    last_published_at = models.DateTimeField(null=True, blank=True)
    published_by = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="published_advancements",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "advancement_rule"
        constraints = [
            models.UniqueConstraint(
                fields=["from_phase", "to_phase"],
                name="uq_advancement_from_to",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.from_phase.key} → {self.to_phase.key} ({self.mode})"


# =====================================================================
# 14. StationSubmission
# =====================================================================

class StationSubmission(models.Model):
    STATUS_DRAFT = "draft"
    STATUS_SUBMITTED = "submitted"
    STATUS_GRADED = "graded"
    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_SUBMITTED, "Submitted"),
        (STATUS_GRADED, "Graded"),
    ]

    station_session = models.ForeignKey(
        StationSession, on_delete=models.CASCADE, null=True, blank=True,
        related_name="submissions",
    )
    team = models.ForeignKey(
        Team, on_delete=models.CASCADE, related_name="station_submissions",
    )
    station = models.ForeignKey(
        Station, on_delete=models.CASCADE, related_name="submissions",
    )
    status = models.CharField(
        max_length=10, choices=STATUS_CHOICES, default=STATUS_DRAFT,
    )
    response_payload = models.JSONField(null=True, blank=True)
    attachment_payload = models.JSONField(null=True, blank=True)
    # Auto-graded quiz result: True/False when the form has a quiz, None otherwise
    is_correct = models.BooleanField(null=True, blank=True)
    # Points awarded by the grader; mirrored into ScoreEntry (kind=station)
    score = models.IntegerField(null=True, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    graded_at = models.DateTimeField(null=True, blank=True)
    graded_by = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="graded_submissions",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "station_submission"

    def __str__(self) -> str:
        return f"Submission by {self.team.code} @ {self.station.code} ({self.status})"


# =====================================================================
# 14a. CaptainVote
# =====================================================================

class CaptainVote(models.Model):
    """A secret ballot for team captain, opened when teams are merged.

    Merging leaves a team with no captain — neither original captain has a claim
    on the other's members — so the team elects one. The ballot is secret: only
    tallies are ever exposed, never who voted for whom, and one vote per member
    (changing your mind replaces it rather than adding another).
    """

    team = models.ForeignKey(
        Team, on_delete=models.CASCADE, related_name="captain_votes",
    )
    voter = models.ForeignKey(
        Participant, on_delete=models.CASCADE, related_name="captain_votes_cast",
    )
    candidate = models.ForeignKey(
        Participant, on_delete=models.CASCADE, related_name="captain_votes_received",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "captain_vote"
        unique_together = [("team", "voter")]

    def __str__(self) -> str:
        return f"Vote in {self.team.code}"


# =====================================================================
# 14b. TeamFormVariant
# =====================================================================

class TeamFormVariant(models.Model):
    """Which quiz questions a team drew, when a station serves a random subset.

    Written once, the first time any member opens the form, then reused. That is
    what makes the draw a *team* fact rather than a per-request one: teammates on
    separate devices get the same questions, and a reload never reshuffles them.
    Stations that serve their whole bank (`quiz.randomCount` = 0) get no row.
    """

    team = models.ForeignKey(
        Team, on_delete=models.CASCADE, related_name="form_variants",
    )
    station = models.ForeignKey(
        Station, on_delete=models.CASCADE, related_name="team_form_variants",
    )
    # Quiz item ids served to this team, in the station's display order.
    item_ids = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "team_form_variant"
        unique_together = [("team", "station")]

    def __str__(self) -> str:
        return f"Variant for {self.team.code} @ {self.station.code} ({len(self.item_ids)} câu)"


# =====================================================================
# 15. DiscordBroadcast
# =====================================================================

class DiscordBroadcast(models.Model):
    TARGET_ALL = "all"
    TARGET_APPROVED = "approved"
    TARGET_PENDING = "pending"
    TARGET_TEAM_IDS = "team_ids"
    TARGET_CHOICES = [
        (TARGET_ALL, "All"),
        (TARGET_APPROVED, "Approved"),
        (TARGET_PENDING, "Pending"),
        (TARGET_TEAM_IDS, "Specific Teams"),
    ]

    STATUS_DRAFT = "draft"
    STATUS_SENDING = "sending"
    STATUS_SENT = "sent"
    STATUS_FAILED = "failed"
    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_SENDING, "Sending"),
        (STATUS_SENT, "Sent"),
        (STATUS_FAILED, "Failed"),
    ]

    title = models.CharField(max_length=255)
    message = models.TextField()
    target = models.CharField(max_length=10, choices=TARGET_CHOICES, default=TARGET_ALL)
    target_payload = models.JSONField(null=True, blank=True)
    sent_by = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="broadcasts",
    )
    status = models.CharField(
        max_length=10, choices=STATUS_CHOICES, default=STATUS_DRAFT,
    )
    error = models.TextField(null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "discord_broadcast"

    def __str__(self) -> str:
        return f"{self.title} ({self.status})"


# =====================================================================
# 16. EmailQueueItem
# =====================================================================

class EmailQueueItem(models.Model):
    STATUS_QUEUED = "queued"
    STATUS_SENDING = "sending"
    STATUS_SENT = "sent"
    STATUS_FAILED = "failed"
    STATUS_CHOICES = [
        (STATUS_QUEUED, "Queued"),
        (STATUS_SENDING, "Sending"),
        (STATUS_SENT, "Sent"),
        (STATUS_FAILED, "Failed"),
    ]

    created_by = models.ForeignKey(
        Account,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="email_queue_items",
    )
    to_emails = models.JSONField(default=list)
    cc_emails = models.JSONField(default=list)
    bcc_emails = models.JSONField(default=list)
    subject = models.CharField(max_length=998)
    html_body = models.TextField()
    status = models.CharField(
        max_length=10,
        choices=STATUS_CHOICES,
        default=STATUS_QUEUED,
        db_index=True,
    )
    scheduled_at = models.DateTimeField(default=timezone.now, db_index=True)
    attempts = models.PositiveIntegerField(default=0)
    max_attempts = models.PositiveIntegerField(default=5)
    sent_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "email_queue_item"
        ordering = ["scheduled_at", "id"]

    def __str__(self) -> str:
        return f"{self.subject} ({self.status})"


# =====================================================================
# 17. AuditLog
# =====================================================================

class AuditLog(models.Model):
    actor = models.ForeignKey(
        Account,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_logs",
    )
    action = models.CharField(max_length=100, db_index=True)
    target_type = models.CharField(max_length=100, null=True, blank=True)
    target_id = models.CharField(max_length=100, null=True, blank=True)
    summary = models.CharField(max_length=500)
    before_data = models.JSONField(null=True, blank=True)
    after_data = models.JSONField(null=True, blank=True)
    metadata = models.JSONField(null=True, blank=True)
    reversible = models.BooleanField(default=False, db_index=True)
    undone_at = models.DateTimeField(null=True, blank=True)
    undone_by = models.ForeignKey(
        Account,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="undone_audit_logs",
    )
    undo_audit = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="undoes",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "audit_log"
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        return f"{self.action}: {self.summary}"


# =====================================================================
# 18. SystemSetting
# =====================================================================

class SystemSetting(models.Model):
    key = models.CharField(max_length=100, unique=True)
    value = models.JSONField()
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "system_setting"

    def __str__(self) -> str:
        return f"{self.key}"


# =====================================================================
# 19. MssvLinkAudit
# =====================================================================

class MssvLinkAudit(models.Model):
    """Audit trail for Account<->Participant linkage by MSSV.

    Recorded when an account claims a participant (by matching MSSV) and the
    account info differs from what was originally entered in the team form, or
    when a claim is blocked because the participant is already linked to another
    account. Doubles as a queue the Discord bot polls (`discord_notified`).
    """

    ACTION_LINKED = "linked"          # first link, no info conflict
    ACTION_OVERWRITTEN = "overwritten"  # linked + participant info overwritten
    ACTION_BLOCKED = "blocked"        # claim rejected (mssv held by other account)
    ACTION_CHOICES = [
        (ACTION_LINKED, "Linked"),
        (ACTION_OVERWRITTEN, "Overwritten"),
        (ACTION_BLOCKED, "Blocked"),
    ]

    mssv = models.CharField(max_length=20)
    participant = models.ForeignKey(
        Participant, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="link_audits",
    )
    account = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="link_audits",
    )
    prev_account = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="link_audits_displaced",
    )
    action = models.CharField(max_length=12, choices=ACTION_CHOICES)
    old_email = models.EmailField(max_length=255, null=True, blank=True)
    new_email = models.EmailField(max_length=255, null=True, blank=True)
    discord_notified = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "mssv_link_audit"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.mssv} {self.action} ({self.old_email} -> {self.new_email})"
