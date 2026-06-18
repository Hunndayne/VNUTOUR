"""
Seed the 4 fixed program phases (plan §2.3, §6.5).

Usage: python manage.py seed_phases
"""

from django.core.management.base import BaseCommand
from api.models import ProgramPhase


FIXED_PHASES = [
    {
        "key": "registration",
        "label": "Đăng ký",
        "hint": "Duyệt đội, hồ sơ và tài khoản trước ngày thi.",
        "order": 1,
    },
    {
        "key": "qualifying",
        "label": "Vòng loại",
        "hint": "Gồm các event nhỏ như social, chạy trạm, quiz, nộp file.",
        "order": 2,
    },
    {
        "key": "final",
        "label": "Vòng chung kết",
        "hint": "Tổng hợp các event của đêm chung kết và chọn top cuối.",
        "order": 3,
    },
    {
        "key": "ended",
        "label": "Kết thúc",
        "hint": "Tổng kết, đối chiếu và khóa kết quả.",
        "order": 4,
    },
]


class Command(BaseCommand):
    help = "Seed the 4 fixed program phases (idempotent)."

    def handle(self, *args, **options):
        created = 0
        updated = 0

        for phase_data in FIXED_PHASES:
            phase, was_created = ProgramPhase.objects.update_or_create(
                key=phase_data["key"],
                defaults={
                    "label": phase_data["label"],
                    "hint": phase_data["hint"],
                    "order": phase_data["order"],
                },
            )
            if was_created:
                created += 1
                self.stdout.write(self.style.SUCCESS(f"  + {phase.key}"))
            else:
                updated += 1
                self.stdout.write(f"  ~ {phase.key} (already exists)")

        # Ensure exactly one phase is current (first phase if none set)
        if not ProgramPhase.objects.filter(is_current=True).exists():
            first = ProgramPhase.objects.order_by("order").first()
            if first:
                first.is_current = True
                first.save(update_fields=["is_current"])
                self.stdout.write(f"  → Set current phase to '{first.key}'")

        self.stdout.write(self.style.SUCCESS(
            f"\nDone: {created} created, {updated} already existed."
        ))
