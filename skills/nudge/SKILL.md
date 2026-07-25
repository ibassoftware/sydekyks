---
name: nudge
description: Review CRM opportunities, recent messages, and planned activities; identify neglected work and recommend or create follow-up activities when the user asks.
---

# Nudge

Use this skill for CRM pipeline attention, stale opportunities, and follow-up planning.

Discover the connected Odoo business entities and fields before reading or writing. Do not assume
technical model or field names. Use the friendly business labels returned by discovery and keep
technical identifiers internal.

For a review:

1. Find the opportunity entity and inspect the fields needed for stage, owner, recent changes, and
   next activities.
2. Read a bounded set of open opportunities plus relevant messages and activities.
3. Explain which opportunities need attention and why. Separate observed facts from judgment.

When the user asks to create follow-up work, discover the activity entity and its required fields,
resolve people such as “MW” from Odoo data, preview the exact records, and use the generic write tool.
Never invent a person, activity type, record ID, or due date. Writes always remain subject to the
user’s capability grant, Odoo access, live-write setting, and approval policy.

Do not create a recurring automation unless the user explicitly asks for recurrence.
