"""Mission card AI usage is aggregated once per requested Mission set."""

import uuid

from app.models.mission import Mission
from app.models.usage_record import UsageRecord
from app.services.missions import usage_by_mission


def test_usage_by_mission_aggregates_tokens_calls_and_capacity(db, seeded):
    tenant = seeded["tenant"]
    ledger = seeded["ledger"]
    mission = Mission(
        tenant_id=tenant.id,
        sydekyk_id=ledger.id,
        mode="workflow_run",
        signal_type="manual",
        playbook_key="ledger.vendor_bill_ingest",
        status="succeeded",
    )
    db.add(mission)
    db.flush()
    db.add_all([
        UsageRecord(
            tenant_id=tenant.id,
            sydekyk_id=ledger.id,
            mission_id=mission.id,
            provider="power_core",
            model="test",
            prompt_tokens=100,
            completion_tokens=50,
            total_tokens=150,
            estimated_gpu_seconds=0.25,
            litellm_request_id=f"test-{uuid.uuid4()}",
        ),
        UsageRecord(
            tenant_id=tenant.id,
            sydekyk_id=ledger.id,
            mission_id=mission.id,
            provider="power_core",
            model="test",
            prompt_tokens=200,
            completion_tokens=75,
            total_tokens=275,
            estimated_gpu_seconds=0.5,
            litellm_request_id=f"test-{uuid.uuid4()}",
        ),
    ])
    db.commit()

    usage = usage_by_mission(db, [mission.id])[mission.id]
    assert usage == {"ai_calls": 2, "tokens_used": 425, "ai_capacity_seconds": 0.75}
