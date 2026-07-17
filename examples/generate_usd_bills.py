"""Generate 30 varied, text-extractable USD vendor-bill PDFs for Ledger.

The data is random-looking but deterministic, which makes the examples useful for
repeatable demos and extraction checks.

Run:  python examples/generate_usd_bills.py
Out:  examples/usd_bills/usd_bill_01.pdf ... usd_bill_30.pdf
"""

from __future__ import annotations

import json
import random
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path


PAGE_W, PAGE_H = 612, 792
MONEY = Decimal("0.01")
OUT_DIR = Path(__file__).with_name("usd_bills")

VENDORS = [
    ("Northstar Office Supply", "1840 Market Street", "Philadelphia, PA 19103", "Office supplies"),
    ("Blue Ridge IT Services", "220 Summit Avenue", "Roanoke, VA 24011", "IT services"),
    ("Harborview Logistics", "77 Pier Road", "Baltimore, MD 21224", "Freight"),
    ("Cedar & Stone Interiors", "915 West Elm Drive", "Austin, TX 78704", "Facilities"),
    ("Brightline Creative Studio", "401 Arts District Way", "Los Angeles, CA 90013", "Marketing"),
    ("Summit Safety Equipment", "6300 Industrial Parkway", "Denver, CO 80216", "Safety equipment"),
    ("Greenfield Janitorial Co.", "125 Cleanway Boulevard", "Columbus, OH 43215", "Janitorial"),
    ("Metro Print & Mail", "38 Commerce Plaza", "Chicago, IL 60607", "Printing"),
    ("CloudPeak Software, Inc.", "500 Mission Street", "San Francisco, CA 94105", "Software"),
    ("Redwood Legal Support", "88 Courthouse Square", "Sacramento, CA 95814", "Professional services"),
    ("Lakeside Catering Group", "1420 Shoreline Drive", "Madison, WI 53703", "Meals"),
    ("Ironwood Maintenance LLC", "607 Service Lane", "Nashville, TN 37210", "Repairs"),
    ("Atlas Business Travel", "250 Terminal Avenue", "Atlanta, GA 30320", "Travel"),
    ("Pioneer Packaging Corp.", "3100 Boxwood Road", "Portland, OR 97230", "Packaging"),
    ("Silver Oak Consulting", "12 Executive Park", "Boston, MA 02110", "Consulting"),
]

ITEMS = {
    "Office supplies": [("Copy paper, 10-ream case", 43, 68), ("Black toner cartridge", 72, 139),
                        ("Desk organizer set", 18, 39), ("Shipping labels, 1,000 pack", 24, 48)],
    "IT services": [("Managed support - monthly", 650, 1450), ("Endpoint security license", 18, 42),
                    ("Network configuration", 120, 220), ("Cloud backup service", 85, 180)],
    "Freight": [("Regional freight service", 210, 580), ("Fuel surcharge", 35, 115),
                ("Liftgate service", 45, 95), ("Pallet handling", 18, 44)],
    "Facilities": [("LED task lamp", 38, 95), ("Ergonomic desk chair", 180, 420),
                   ("Conference room table", 620, 1250), ("Installation labor", 95, 180)],
    "Marketing": [("Campaign design services", 700, 1800), ("Digital ad creative set", 320, 850),
                  ("Brand template package", 450, 980), ("Image licensing", 55, 170)],
    "Safety equipment": [("Safety glasses, 12 pack", 36, 78), ("First aid refill kit", 48, 105),
                         ("High-visibility vest", 14, 32), ("Nitrile gloves, case", 65, 130)],
    "Janitorial": [("Evening cleaning service", 480, 920), ("Floor treatment", 175, 390),
                   ("Restroom supply refill", 85, 195), ("Window cleaning", 140, 310)],
    "Printing": [("Color brochures, 500", 165, 340), ("Business cards, 250", 45, 95),
                 ("Postage and handling", 22, 68), ("Presentation folders, 100", 110, 230)],
    "Software": [("Team software subscription", 240, 780), ("Additional user license", 22, 55),
                 ("Data storage add-on", 65, 190), ("Priority support plan", 180, 420)],
    "Professional services": [("Document review", 280, 650), ("Filing and retrieval", 75, 190),
                              ("Research services", 220, 540), ("Courier disbursement", 28, 75)],
    "Meals": [("Team lunch catering", 240, 620), ("Beverage service", 55, 140),
              ("Service staff", 120, 260), ("Equipment rental", 65, 180)],
    "Repairs": [("Preventive maintenance visit", 280, 620), ("Replacement parts", 95, 380),
                ("Technician labor", 110, 190), ("Emergency call-out fee", 145, 260)],
    "Travel": [("Round-trip airfare", 320, 780), ("Hotel reservation", 145, 310),
               ("Ground transportation", 45, 135), ("Agency service fee", 28, 65)],
    "Packaging": [("Corrugated cartons, bundle", 48, 115), ("Packing tape, case", 42, 92),
                  ("Protective mailers, 100", 55, 135), ("Custom inserts, 250", 120, 290)],
    "Consulting": [("Strategy workshop", 850, 1900), ("Process assessment", 700, 1600),
                   ("Implementation support", 620, 1450), ("Travel expenses", 90, 280)],
}


def esc(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


class PDF:
    def __init__(self) -> None:
        self.ops: list[str] = []

    def text(self, x: float, y: float, value: str, size: float = 10, bold: bool = False,
             color: tuple[float, float, float] = (0.08, 0.08, 0.08)) -> None:
        font = "F2" if bold else "F1"
        self.ops.append(
            f"BT /{font} {size:.1f} Tf {color[0]:.3f} {color[1]:.3f} {color[2]:.3f} rg "
            f"{x:.1f} {y:.1f} Td ({esc(value)}) Tj ET"
        )

    def line(self, x1: float, y1: float, x2: float, y2: float,
             color: tuple[float, float, float] = (0.25, 0.25, 0.25), width: float = 0.8) -> None:
        self.ops.append(
            f"{width:.1f} w {color[0]:.3f} {color[1]:.3f} {color[2]:.3f} RG "
            f"{x1:.1f} {y1:.1f} m {x2:.1f} {y2:.1f} l S"
        )

    def rect(self, x: float, y: float, w: float, h: float,
             color: tuple[float, float, float]) -> None:
        self.ops.append(f"{color[0]:.3f} {color[1]:.3f} {color[2]:.3f} rg {x} {y} {w} {h} re f")

    def build(self) -> bytes:
        stream = ("\n".join(self.ops) + "\n").encode("cp1252", "replace")
        objects = [
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
            b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"endstream",
            b"<< /Type /Page /Parent 5 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 1 0 R /F2 2 0 R >> >> /Contents 3 0 R >>",
            b"<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
            b"<< /Type /Catalog /Pages 5 0 R >>",
        ]
        out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets = [0]
        for number, body in enumerate(objects, 1):
            offsets.append(len(out))
            out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
        xref = len(out)
        out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
        out += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:])
        out += f"trailer\n<< /Size 7 /Root 6 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
        return bytes(out)


def money(value: Decimal) -> str:
    return f"${value:,.2f}"


def make_bill(index: int) -> tuple[bytes, dict]:
    rng = random.Random(48_201 + index)
    vendor, street, city, category = VENDORS[(index * 7 + 2) % len(VENDORS)]
    invoice_date = date(2025, 8, 1) + timedelta(days=rng.randint(0, 345))
    terms_days = rng.choice([15, 30, 30, 45])
    invoice_number = f"{rng.choice(['INV', 'BILL', 'US', 'AR'])}-{invoice_date:%y%m}-{rng.randint(1000, 9999)}"
    tax_rate = Decimal(str(rng.choice([0, 0, 5, 6.25, 7.25, 8.25, 8.875, 10.25])))
    selected = rng.sample(ITEMS[category], rng.randint(2, 4))
    lines = []
    for description, low, high in selected:
        quantity = rng.randint(1, 5)
        unit_price = Decimal(str(rng.randint(low * 100, high * 100))) / 100
        amount = (unit_price * quantity).quantize(MONEY)
        lines.append((description, quantity, unit_price, amount))
    subtotal = sum((line[3] for line in lines), Decimal("0.00"))
    tax = (subtotal * tax_rate / 100).quantize(MONEY, ROUND_HALF_UP)
    total = subtotal + tax
    due_date = invoice_date + timedelta(days=terms_days)
    accent = rng.choice([(0.08, 0.28, 0.48), (0.10, 0.38, 0.32), (0.48, 0.18, 0.14),
                         (0.25, 0.22, 0.42), (0.18, 0.18, 0.18)])
    layout = index % 3

    pdf = PDF()
    if layout == 0:
        pdf.rect(0, 710, PAGE_W, 82, accent)
        pdf.text(42, 748, vendor.upper(), 18, True, (1, 1, 1))
        pdf.text(42, 728, f"{street} | {city}", 9, False, (1, 1, 1))
        pdf.text(470, 744, "INVOICE", 20, True, (1, 1, 1))
    elif layout == 1:
        pdf.rect(38, 724, 8, 46, accent)
        pdf.text(58, 750, vendor, 19, True, accent)
        pdf.text(58, 730, f"{street}, {city}", 9)
        pdf.text(465, 746, "VENDOR BILL", 16, True)
        pdf.line(38, 710, 574, 710, accent, 2)
    else:
        pdf.text(42, 752, vendor, 20, True)
        pdf.text(42, 733, street, 9)
        pdf.text(42, 719, city, 9)
        pdf.rect(430, 721, 144, 48, accent)
        pdf.text(454, 740, "INVOICE", 20, True, (1, 1, 1))

    pdf.text(42, 674, "BILL TO", 9, True, accent)
    pdf.text(42, 656, "Sydekyks HQ", 11, True)
    pdf.text(42, 640, "100 Innovation Way", 9)
    pdf.text(42, 626, "New York, NY 10001", 9)
    pdf.text(352, 674, "Invoice number", 9, True)
    pdf.text(472, 674, invoice_number, 9)
    pdf.text(352, 656, "Invoice date", 9, True)
    pdf.text(472, 656, invoice_date.isoformat(), 9)
    pdf.text(352, 638, "Payment terms", 9, True)
    pdf.text(472, 638, f"Net {terms_days}", 9)
    pdf.text(352, 620, "Due date", 9, True)
    pdf.text(472, 620, due_date.isoformat(), 9)
    pdf.text(352, 602, "Currency", 9, True)
    pdf.text(472, 602, "USD", 9)

    table_top = 568
    pdf.rect(38, table_top, 536, 28, accent)
    pdf.text(48, table_top + 9, "DESCRIPTION", 9, True, (1, 1, 1))
    pdf.text(345, table_top + 9, "QTY", 9, True, (1, 1, 1))
    pdf.text(403, table_top + 9, "UNIT PRICE", 9, True, (1, 1, 1))
    pdf.text(520, table_top + 9, "AMOUNT", 9, True, (1, 1, 1))
    y = table_top - 25
    for row, (description, quantity, unit_price, amount) in enumerate(lines):
        if row % 2 == 0:
            pdf.rect(38, y - 7, 536, 25, (0.95, 0.96, 0.97))
        pdf.text(48, y, description, 9)
        pdf.text(354, y, str(quantity), 9)
        pdf.text(410, y, money(unit_price), 9)
        pdf.text(520, y, money(amount), 9)
        y -= 29
    pdf.line(350, y + 6, 574, y + 6, accent, 1)
    pdf.text(392, y - 14, "Subtotal", 10, True)
    pdf.text(515, y - 14, money(subtotal), 10)
    pdf.text(392, y - 36, f"Sales tax ({tax_rate.normalize()}%)", 10, True)
    pdf.text(515, y - 36, money(tax), 10)
    pdf.rect(378, y - 75, 196, 30, accent)
    pdf.text(392, y - 65, "TOTAL USD", 11, True, (1, 1, 1))
    pdf.text(505, y - 65, money(total), 11, True, (1, 1, 1))

    footer_y = 95
    pdf.line(38, footer_y + 34, 574, footer_y + 34, (0.65, 0.65, 0.65), 0.6)
    pdf.text(42, footer_y + 15, f"Please remit {money(total)} by {due_date.isoformat()}.", 9, True)
    pdf.text(42, footer_y, f"Reference {invoice_number} with payment. Thank you for your business.", 8)
    pdf.text(430, footer_y, f"Tax ID: {rng.randint(10, 98)}-{rng.randint(1000000, 9999999)}", 8)

    expected = {
        "filename": f"usd_bill_{index:02d}.pdf",
        "vendor_name": vendor,
        "invoice_number": invoice_number,
        "invoice_date": invoice_date.isoformat(),
        "currency": "USD",
        "subtotal": float(subtotal),
        "tax_amount": float(tax),
        "total": float(total),
        "line_items": [
            {"description": d, "quantity": q, "unit_price": float(u), "amount": float(a)}
            for d, q, u, a in lines
        ],
    }
    return pdf.build(), expected


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = []
    for index in range(1, 31):
        data, expected = make_bill(index)
        (OUT_DIR / expected["filename"]).write_bytes(data)
        manifest.append(expected)
        print(f"wrote {expected['filename']} ({len(data)} bytes)")
    (OUT_DIR / "expected.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
