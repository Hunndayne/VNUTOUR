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
    # The Discord handle captured when the account links, so the web can show
    # "connected as @X" for the participant to eyeball the right account. Purely
    # a display aid — discord_id stays the identity of record.
    discord_username = models.CharField(max_length=64, null=True, blank=True)
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
    # Random 6-digit code, stable per team, for future auto-reconciliation of bank transfers.
    payment_code = models.CharField(max_length=6, null=True, blank=True)
    # Uploaded payment proof file metadata: {name,size,type,key,storage,url?} (R2/local).
    # Kept alongside the legacy `payment_proof` (pasted link) field, which stays as-is.
    payment_proof_file = models.JSONField(null=True, blank=True)
    # Set the moment the captain confirms the roster on the payment confirm
    # dialog. Member add/edit/remove and renames are refused afterwards so the
    # transfer amount (fee x member count) and memo stay what was confirmed.
    # Cleared when the organisers reject the team — asked-for fixes must stay
    # possible — and by a merge, which reshapes the roster anyway.
    roster_locked_at = models.DateTimeField(null=True, blank=True)
    # Set once BTC's Timo money-pot auto-reconciliation (or, later, a manual
    # admin action) matches a transfer to this team's payment_code + amount.
    # While unset the captain may still cancel payment (unlocks the roster);
    # once set, payment is final — cancel is refused and the roster stays locked.
    payment_confirmed_at = models.DateTimeField(null=True, blank=True)
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
    TYPE_SURVEY = "survey"
    TYPE_CUSTOM = "custom"
    TYPE_CHOICES = [
        (TYPE_WORKFLOW, "Workflow"),
        (TYPE_SOCIAL, "Social"),
        (TYPE_STATION_RUN, "Station Run"),
        (TYPE_QUIZ, "Quiz"),
        (TYPE_SUBMISSION, "Submission"),
        (TYPE_SURVEY, "Survey"),
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
    # Qualifying-round "play it again" rule: once on, a team may only re-enter a
    # station it has already closed a session at after it has visited every
    # other active station of the event, and never again once it has passed
    # that station. Off by default so every other event keeps today's
    # unlimited-replay behaviour.
    replay_after_all = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sub_event"
        ordering = ["phase", "order"]

    def __str__(self) -> str:
        return f"{self.name} ({self.phase.key})"


# =====================================================================
# 6a. QuestionBankItem
# =====================================================================

class QuestionBankItem(models.Model):
    sub_event = models.ForeignKey(
        SubEvent, on_delete=models.CASCADE, related_name="question_bank",
    )
    type = models.CharField(max_length=20, default="quiz")
    question = models.TextField()
    options = models.JSONField(default=list)
    correct_option = models.IntegerField(null=True, blank=True)
    correct_text = models.JSONField(default=list, blank=True)
    points = models.IntegerField(default=1)
    order = models.IntegerField(default=0)
    active = models.BooleanField(default=True)
    tags = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "question_bank_item"
        ordering = ["sub_event", "order", "id"]

    def __str__(self) -> str:
        return f"BankItem {self.id} (SubEvent {self.sub_event_id})"


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

    # How a team's visits to this station turn into a score. `pass_points` and
    # `pass_threshold` are only meaningful for their matching mode — the other
    # sits unused at its default of 0, which also happens to be the safe no-op
    # value if a station is ever switched between modes.
    SCORING_PASS_FAIL = "pass_fail"
    SCORING_THRESHOLD = "threshold"
    SCORING_SCORE_ONLY = "score_only"
    SCORING_CHOICES = [
        (SCORING_PASS_FAIL, "Đạt/Không đạt"),
        (SCORING_THRESHOLD, "Ngưỡng điểm đạt"),
        (SCORING_SCORE_ONLY, "Chỉ nhập điểm"),
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
    scoring_mode = models.CharField(
        max_length=20, choices=SCORING_CHOICES, default=SCORING_SCORE_ONLY,
    )
    pass_threshold = models.IntegerField(default=0)
    pass_points = models.IntegerField(default=0)
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

    # Whether this particular visit cleared the station, independent of
    # `status`: a session can be `closed` (the team walked away) yet still
    # `pending` if nobody has graded it, or `failed` and still worth re-playing
    # under the replay rule. Set at checkout time, see `station_service`.
    OUTCOME_PENDING = "pending"
    OUTCOME_PASSED = "passed"
    OUTCOME_FAILED = "failed"
    OUTCOME_CHOICES = [
        (OUTCOME_PENDING, "Chưa chấm"),
        (OUTCOME_PASSED, "Đạt"),
        (OUTCOME_FAILED, "Không đạt"),
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
    outcome = models.CharField(
        max_length=10, choices=OUTCOME_CHOICES, default=OUTCOME_PENDING,
    )
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
# 14b. TeamFormSession
# =====================================================================

class TeamFormSession(models.Model):
    """Tracks when a team explicitly starts a form that has a time limit."""
    team = models.ForeignKey(
        Team, on_delete=models.CASCADE, related_name="form_sessions",
    )
    station = models.ForeignKey(
        Station, on_delete=models.CASCADE, related_name="team_form_sessions",
    )
    started_at = models.DateTimeField(auto_now_add=True)
    started_by = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True,
    )

    class Meta:
        db_table = "team_form_session"
        constraints = [
            models.UniqueConstraint(
                fields=["team", "station"],
                name="uq_team_form_session_station",
            )
        ]

# 14c. TeamFormVariant
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
# 14c. TeamFormDraft
# =====================================================================

class TeamFormDraft(models.Model):
    """The in-progress answers a team is still typing, shared across its members.

    Kept apart from `StationSubmission` on purpose: a draft is not a submission
    attempt, so saving one must never touch submission status, count against
    `limits.maxSubmissions`, or trigger grading. It also carries no attachments —
    files live on whichever device picked them and cannot be synced through JSON.
    """

    team = models.ForeignKey(
        Team, on_delete=models.CASCADE, related_name="form_drafts",
    )
    station = models.ForeignKey(
        Station, on_delete=models.CASCADE, related_name="team_form_drafts",
    )
    response_payload = models.JSONField(null=True, blank=True)
    updated_by = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="updated_form_drafts",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "team_form_draft"
        unique_together = [("team", "station")]

    def __str__(self) -> str:
        return f"Draft for {self.team.code} @ {self.station.code}"


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
# 20. PhotoFrame — public "ghép khung ảnh" tool
# =====================================================================

class PhotoFrame(models.Model):
    """An admin-uploaded transparent frame the public photo tool overlays on top
    of a user's photo.

    The frame is the top layer with a fixed output size (its own natural pixel
    dimensions); the visitor's photo is the bottom layer, freely moved / scaled /
    rotated beneath it. The image bytes are kept in the same R2/local storage the
    rest of the app uses (see submission_storage_service), described by the
    ``image`` metadata dict — ``{name, size, type, key, storage, url}`` — rather
    than a Django FileField, so the frame can be served same-origin (avoiding the
    canvas-taint / CORS problem when the browser composites and exports).
    """

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="")

    # Stored-file descriptor, same shape submission_storage_service returns.
    image = models.JSONField(default=dict, blank=True)
    # Natural pixel size of the frame image; the editor uses it as the canvas /
    # output size and to preserve aspect ratio.
    width = models.PositiveIntegerField(default=0)
    height = models.PositiveIntegerField(default=0)

    # Only active frames are exposed to the public gallery; drafts stay admin-only.
    is_active = models.BooleanField(default=False, db_index=True)
    # Manual ordering in the public gallery (lower shown first).
    sort_order = models.IntegerField(default=0)
    # Denormalised counter kept in step with FrameDownloadLog for cheap listing.
    download_count = models.PositiveIntegerField(default=0)

    created_by = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="uploaded_frames",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "photo_frame"
        ordering = ["sort_order", "-created_at"]

    def __str__(self) -> str:
        return self.title


# =====================================================================
# 21. FrameDownloadLog — one row per successful compose + download
# =====================================================================

class FrameDownloadLog(models.Model):
    """Records every time a visitor successfully composes and downloads a framed
    photo, so admins can see how much each frame is used.

    The frame title is snapshotted so stats survive the frame being deleted.
    """

    frame = models.ForeignKey(
        PhotoFrame, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="downloads",
    )
    frame_title = models.CharField(max_length=200, blank=True, default="")
    account = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="frame_downloads",
    )
    ip = models.CharField(max_length=64, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "frame_download_log"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.frame_title} @ {self.created_at:%Y-%m-%d %H:%M}"


# =====================================================================
# 22. MssvLinkAudit
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


# =====================================================================
# 23. ShortLink
# =====================================================================

class ShortLink(models.Model):
    """A vanity redirect served at `/s/<code>` → `target_url`.

    Admins create these to hand out short, printable URLs (the registration
    form, a Discord invite, a deep SPA link with query strings) instead of
    long ones, typically baked into posters or QR codes. Every hop is counted
    (`click_count`) so channels can be compared afterwards.
    """

    code = models.CharField(max_length=32, unique=True)
    target_url = models.CharField(max_length=2048)
    # Free-form admin note saying what the link is for; shown only in the
    # admin list, never on the redirect page.
    label = models.CharField(max_length=200, blank=True, default="")
    is_active = models.BooleanField(default=True, db_index=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    click_count = models.PositiveIntegerField(default=0)
    last_clicked_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="short_links",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "short_link"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"/s/{self.code} -> {self.label or self.target_url}"


# =====================================================================
# 24. PasswordResetToken
# =====================================================================

class PasswordResetToken(models.Model):
    """One-time token for the forgot/reset password flow.

    The raw token is emailed to the account and never stored — only its
    SHA-256 hash (`token_hash`) is kept, so a database leak alone can't be
    used to reset anyone's password. `used_at` enforces single use;
    `expires_at` is set from `settings.PASSWORD_RESET_TOKEN_TTL_HOURS` at
    creation time.
    """

    account = models.ForeignKey(
        Account, on_delete=models.CASCADE,
        related_name="password_reset_tokens",
    )
    token_hash = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "password_reset_token"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"reset token for {self.account.username} (used={bool(self.used_at)})"
