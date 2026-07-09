"""Generate 20 realistic 2-3 page DEVELOPER résumés as text-extractable PDFs (zero dependencies).

Pure-Python PDF writer (standard 14 fonts, WinAnsi) so the output stays text-extractable for
Decode/Scout's text-first path — no reportlab/fpdf needed. Each résumé randomizes fonts, accent
colour, header style, skills layout (table / categorised / inline), section order, and content, so a
batch feels like a real inbox. Seeded per file for reproducible output.

Run:  python examples/generate_dev_resumes.py
Out:  examples/resumes/dev_01_<lastname>.pdf ... dev_20_<lastname>.pdf
"""

import os
import random

PAGE_W, PAGE_H = 612.0, 792.0
MARGIN_X = 54.0
TOP = 754.0
BOTTOM = 58.0

FONTS = [
    "Helvetica", "Helvetica-Bold", "Helvetica-Oblique",
    "Times-Roman", "Times-Bold", "Times-Italic",
    "Courier", "Courier-Bold",
]
FONT_RES = {name: f"F{i}" for i, name in enumerate(FONTS)}
WIDTH_FACTOR = {
    "Helvetica": 0.52, "Helvetica-Bold": 0.55, "Helvetica-Oblique": 0.52,
    "Times-Roman": 0.48, "Times-Bold": 0.50, "Times-Italic": 0.48,
    "Courier": 0.60, "Courier-Bold": 0.60,
}

# Family -> (regular, bold, italic)
FAMILIES = {
    "helvetica": ("Helvetica", "Helvetica-Bold", "Helvetica-Oblique"),
    "times": ("Times-Roman", "Times-Bold", "Times-Italic"),
}
HEADING_FONTS = ["Helvetica-Bold", "Times-Bold", "Courier-Bold"]
ACCENTS = [
    (0.14, 0.20, 0.42), (0.10, 0.36, 0.34), (0.44, 0.14, 0.16), (0.20, 0.20, 0.20),
    (0.30, 0.22, 0.10), (0.12, 0.28, 0.48), (0.36, 0.16, 0.42), (0.08, 0.30, 0.22),
]


def _esc(s: str) -> bytes:
    b = s.encode("cp1252", "replace")
    out = bytearray()
    for ch in b:
        if ch in (0x5C, 0x28, 0x29):
            out += b"\\" + bytes([ch])
        elif ch < 32 or ch == 127:
            out.append(0x20)
        else:
            out.append(ch)
    return bytes(out)


def text_width(s: str, font: str, size: float) -> float:
    return len(s) * WIDTH_FACTOR[font] * size


def wrap(s: str, font: str, size: float, max_w: float) -> list[str]:
    words, lines, cur = s.split(), [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if text_width(trial, font, size) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


class Doc:
    def __init__(self):
        self.pages = []          # list of content bytearrays
        self.buf = None
        self.new_page()

    def new_page(self):
        self.buf = bytearray()
        self.pages.append(self.buf)

    def _col(self, c):
        return f"{c[0]:.3f} {c[1]:.3f} {c[2]:.3f}".encode()

    def text(self, x, y, s, font, size, color=(0, 0, 0)):
        self.buf += (b"BT /" + FONT_RES[font].encode() + f" {size:.2f} Tf ".encode()
                     + self._col(color) + b" rg "
                     + f"{x:.2f} {y:.2f} Td (".encode() + _esc(s) + b") Tj ET\n")

    def rect(self, x, y, w, h, color):
        self.buf += (self._col(color) + f" rg {x:.2f} {y:.2f} {w:.2f} {h:.2f} re f\n".encode())

    def line(self, x1, y1, x2, y2, color, width=0.8):
        self.buf += (f"{width:.2f} w ".encode() + self._col(color)
                     + f" RG {x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l S\n".encode())

    def build(self) -> bytes:
        objs = []           # (body bytes)

        def add(body: bytes) -> int:
            objs.append(body)
            return len(objs)  # 1-based obj number

        font_nums = {}
        for name in FONTS:
            font_nums[name] = add(
                b"<< /Type /Font /Subtype /Type1 /BaseFont /" + name.encode()
                + b" /Encoding /WinAnsiEncoding >>"
            )
        res = b"<< /Font << " + b" ".join(
            b"/" + FONT_RES[n].encode() + f" {font_nums[n]} 0 R".encode() for n in FONTS
        ) + b" >> >>"

        pages_obj_num = len(objs) + 1 + 2 * len(self.pages) + 1  # reserve; recompute below
        # Build content + page objects, collecting page obj numbers.
        page_obj_nums = []
        content_nums = []
        for content in self.pages:
            cnum = add(b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n"
                       + bytes(content) + b"\nendstream")
            content_nums.append(cnum)
        pages_parent_num = len(objs) + len(self.pages) + 1  # after page objs
        for cnum in content_nums:
            pnum = add(
                b"<< /Type /Page /Parent " + str(pages_parent_num).encode()
                + b" 0 R /MediaBox [0 0 612 792] /Resources " + res
                + b" /Contents " + str(cnum).encode() + b" 0 R >>"
            )
            page_obj_nums.append(pnum)
        kids = b"[ " + b" ".join(str(n).encode() + b" 0 R" for n in page_obj_nums) + b" ]"
        pages_num = add(b"<< /Type /Pages /Kids " + kids + b" /Count "
                        + str(len(page_obj_nums)).encode() + b" >>")
        assert pages_num == pages_parent_num, (pages_num, pages_parent_num)
        catalog_num = add(b"<< /Type /Catalog /Pages " + str(pages_num).encode() + b" 0 R >>")

        out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets = [0]
        for i, body in enumerate(objs, start=1):
            offsets.append(len(out))
            out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
        xref_pos = len(out)
        n = len(objs) + 1
        out += f"xref\n0 {n}\n".encode()
        out += b"0000000000 65535 f \n"
        for off in offsets[1:]:
            out += f"{off:010d} 00000 n \n".encode()
        out += (b"trailer\n<< /Size " + str(n).encode() + b" /Root "
                + str(catalog_num).encode() + b" 0 R >>\nstartxref\n"
                + str(xref_pos).encode() + b"\n%%EOF")
        return bytes(out)


class Layout:
    def __init__(self, doc: Doc, fam, accent):
        self.d = doc
        self.reg, self.bold, self.ital = fam
        self.accent = accent
        self.y = TOP

    def _ensure(self, h):
        if self.y - h < BOTTOM:
            self.d.new_page()
            self.y = TOP

    def gap(self, h):
        self.y -= h

    def rule(self, color=None, width=0.8):
        self._ensure(8)
        self.d.line(MARGIN_X, self.y, PAGE_W - MARGIN_X, self.y, color or self.accent, width)
        self.y -= 8

    def heading(self, text, font=None, size=11.5):
        font = font or self.bold
        self._ensure(size + 10)
        self.y -= size + 2
        self.d.text(MARGIN_X, self.y, text.upper(), font, size, self.accent)
        self.y -= 3
        self.d.line(MARGIN_X, self.y, PAGE_W - MARGIN_X, self.y, self.accent, 1.1)
        self.y -= 8

    def para(self, text, size=9.5, color=(0.16, 0.16, 0.16), font=None, lead=3.0):
        font = font or self.reg
        max_w = PAGE_W - 2 * MARGIN_X
        for line in wrap(text, font, size, max_w):
            self._ensure(size + lead)
            self.y -= size
            self.d.text(MARGIN_X, self.y, line, font, size, color)
            self.y -= lead

    def kv_line(self, left, right, size=9.5):
        """Left text + right-aligned text on the same baseline (e.g. title ... dates)."""
        self._ensure(size + 4)
        self.y -= size
        self.d.text(MARGIN_X, self.y, left, self.bold, size, (0.10, 0.10, 0.10))
        rw = text_width(right, self.ital, size)
        self.d.text(PAGE_W - MARGIN_X - rw, self.y, right, self.ital, size, (0.35, 0.35, 0.35))
        self.y -= 3

    def subtle(self, text, size=9.0):
        self._ensure(size + 3)
        self.y -= size
        self.d.text(MARGIN_X, self.y, text, self.ital, size, (0.40, 0.40, 0.40))
        self.y -= 3

    def bullets(self, items, size=9.5, color=(0.16, 0.16, 0.16)):
        max_w = PAGE_W - 2 * MARGIN_X - 14
        for it in items:
            lines = wrap(it, self.reg, size, max_w)
            for i, line in enumerate(lines):
                self._ensure(size + 3)
                self.y -= size
                if i == 0:
                    self.d.text(MARGIN_X + 2, self.y, "•", self.bold, size, self.accent)
                self.d.text(MARGIN_X + 14, self.y, line, self.reg, size, color)
                self.y -= 3

    def table(self, rows, widths, size=9.0, header=True, zebra=True):
        """rows: list of list[str]; widths: fractional column widths summing ~1."""
        total = PAGE_W - 2 * MARGIN_X
        cols = [w * total for w in widths]
        pad = 4.0
        for r, row in enumerate(rows):
            # wrap each cell, compute row height
            cell_lines = [wrap(str(c), self.reg, size, cols[i] - 2 * pad) for i, c in enumerate(row)]
            rh = max(len(cl) for cl in cell_lines) * (size + 2) + 2 * pad - 2
            self._ensure(rh + 2)
            top = self.y
            if header and r == 0:
                self.d.rect(MARGIN_X, top - rh, total, rh, self.accent)
            elif zebra and r % 2 == 1:
                self.d.rect(MARGIN_X, top - rh, total, rh, (0.95, 0.95, 0.95))
            x = MARGIN_X
            for i, lines in enumerate(cell_lines):
                ty = top - pad - size
                for line in lines:
                    fnt = self.bold if (header and r == 0) else self.reg
                    col = (1, 1, 1) if (header and r == 0) else (0.16, 0.16, 0.16)
                    self.d.text(x + pad, ty + 2, line, fnt, size, col)
                    ty -= size + 2
                x += cols[i]
            # borders
            self.d.line(MARGIN_X, top - rh, MARGIN_X + total, top - rh, (0.80, 0.80, 0.80), 0.6)
            self.y = top - rh
        self.y -= 6


# --------------------------------------------------------------------------- data pools

FIRST = ["Alex", "Jordan", "Taylor", "Morgan", "Riley", "Casey", "Jamie", "Priya", "Wei", "Diego",
         "Sofia", "Liam", "Noah", "Emma", "Aisha", "Marcus", "Elena", "Hiroshi", "Fatima", "Lucas",
         "Chloe", "Mateo", "Nadia", "Omar", "Ivan", "Grace", "Kai", "Leila", "Ethan", "Zoe"]
LAST = ["Carter", "Nguyen", "Patel", "Silva", "Kim", "Okafor", "Rossi", "Andersson", "Haddad", "Novak",
        "Reyes", "Fischer", "Costa", "Ivanov", "Bianchi", "Tanaka", "Sharma", "Dubois", "Moretti", "Vasquez",
        "Larsen", "Khan", "Ferrari", "Sato", "Mensah", "Popescu", "Lindqvist", "Adeyemi", "Baker", "Cohen"]
CITIES = ["Austin, TX", "Seattle, WA", "Berlin, DE", "Toronto, ON", "London, UK", "Amsterdam, NL",
          "Singapore", "Sydney, AU", "Bengaluru, IN", "Lisbon, PT", "Denver, CO", "Dublin, IE",
          "Barcelona, ES", "Warsaw, PL", "Chicago, IL", "Manchester, UK", "Cape Town, ZA", "Manila, PH"]
COMPANIES = ["Northwind Labs", "Brightwave", "Cobalt Systems", "Meridian Software", "Riverpoint Tech",
             "Lumen Analytics", "Ironclad Digital", "Vantage Cloud", "Pinecrest Solutions", "Helix Data",
             "Skylark Interactive", "Quanta Works", "Delphi Networks", "Foundry42", "Arcadia Labs",
             "Beacon Systems", "Nimbus Studios", "Everfield", "Tessera Tech", "Zephyr Software"]
FLAVORS = [
    ("Full Stack Developer", "backend"), ("Backend Developer", "backend"),
    ("Frontend Developer", "frontend"), ("Software Engineer", "backend"),
    ("Mobile Developer", "mobile"), ("Full Stack Engineer", "frontend"),
]
STACK = {
    "backend": {
        "Languages": ["Python", "Go", "Java", "C#", "Ruby", "TypeScript"],
        "Frameworks": ["Django", "FastAPI", "Spring Boot", ".NET", "Rails", "Express"],
        "Databases": ["PostgreSQL", "MySQL", "Redis", "MongoDB", "DynamoDB"],
        "Cloud & DevOps": ["AWS", "Docker", "Kubernetes", "Terraform", "GitHub Actions"],
    },
    "frontend": {
        "Languages": ["JavaScript", "TypeScript", "HTML", "CSS", "Dart"],
        "Frameworks": ["React", "Vue", "Next.js", "Svelte", "Tailwind", "Redux"],
        "Tooling": ["Vite", "Webpack", "Jest", "Cypress", "Storybook"],
        "Cloud & DevOps": ["Vercel", "Netlify", "Docker", "AWS S3/CloudFront"],
    },
    "mobile": {
        "Languages": ["Kotlin", "Swift", "Dart", "Java", "TypeScript"],
        "Frameworks": ["Flutter", "React Native", "Jetpack Compose", "SwiftUI"],
        "Databases": ["SQLite", "Realm", "Firebase"],
        "Cloud & DevOps": ["Fastlane", "App Center", "Firebase", "GitHub Actions"],
    },
}
UNIS = ["State University", "Institute of Technology", "Polytechnic University", "City University",
        "National University", "College of Engineering"]
DEGREES = ["B.Sc. Computer Science", "B.Eng. Software Engineering", "B.Sc. Information Systems",
           "M.Sc. Computer Science", "B.Sc. Computer Engineering"]
CERTS = ["AWS Certified Developer - Associate", "Certified Kubernetes Application Developer (CKAD)",
         "Google Associate Cloud Engineer", "Microsoft Certified: Azure Developer Associate",
         "MongoDB Certified Developer", "Scrum Alliance CSD", "HashiCorp Terraform Associate"]
LANGS = ["English (native)", "Spanish (fluent)", "German (professional)", "French (conversational)",
         "Mandarin (native)", "Portuguese (fluent)", "Japanese (professional)", "Arabic (native)"]

VERBS = ["Built", "Designed", "Led", "Shipped", "Optimized", "Migrated", "Automated", "Refactored",
         "Scaled", "Implemented", "Owned", "Delivered", "Architected", "Reduced"]
OBJECTS = {
    "backend": ["a payments microservice handling {n}k requests/min", "the billing REST API",
                "an event-driven ingestion pipeline", "the authentication + RBAC layer",
                "a background job system on Redis queues", "the reporting data warehouse ETL",
                "a GraphQL gateway over {m} services", "the notification delivery service"],
    "frontend": ["a component library used across {m} apps", "the checkout flow ({p}% conversion lift)",
                 "a real-time dashboard with WebSockets", "the design-system migration to {fw}",
                 "an accessible (WCAG AA) admin console", "the SSR marketing site on Next.js",
                 "a drag-and-drop form builder", "the mobile-responsive customer portal"],
    "mobile": ["a cross-platform app with {m}k installs", "the offline-first sync engine",
               "in-app purchases and subscriptions", "the push-notification pipeline",
               "a biometric login flow", "the CI/CD release pipeline via Fastlane",
               "an image-caching layer cutting load time {p}%", "the analytics + crash reporting stack"],
}
OUTCOMES = ["cutting p95 latency {p}%", "reducing cloud spend {p}%", "raising test coverage to {t}%",
            "improving CI time by {p}%", "supporting {n}k daily active users", "eliminating {n} on-call pages/week",
            "increasing throughput {p}%", "shrinking bundle size {p}%"]


def bullet(track, rng):
    v = rng.choice(VERBS)
    o = rng.choice(OBJECTS[track]).format(n=rng.randint(4, 80), m=rng.randint(3, 40),
                                          p=rng.randint(15, 60), fw=rng.choice(["React", "Vue", "Svelte"]))
    s = f"{v} {o}"
    if rng.random() < 0.7:
        s += ", " + rng.choice(OUTCOMES).format(p=rng.randint(15, 65), t=rng.randint(70, 95),
                                                n=rng.randint(2, 90))
    return s + "."


def make_resume(i: int) -> tuple[str, bytes]:
    rng = random.Random(2000 + i)
    fam_name = rng.choice(list(FAMILIES))
    fam = FAMILIES[fam_name]
    accent = rng.choice(ACCENTS)
    heading_font = rng.choice(HEADING_FONTS)
    first, last = rng.choice(FIRST), rng.choice(LAST)
    city = rng.choice(CITIES)
    title, track = rng.choice(FLAVORS)
    # Career length is the sum of the job spans below, so dates, years-of-experience, and seniority
    # all agree (no "Junior" with a 13-year history).
    n_jobs = rng.randint(4, 5)
    spans = [rng.randint(1, 3) for _ in range(n_jobs)]
    years = sum(spans)
    level_name = "Junior" if years < 3 else ("" if years < 6 else ("Senior" if years < 9 else "Lead"))
    full_title = (level_name + " " + title).strip()
    email = f"{first.lower()}.{last.lower()}@{rng.choice(['gmail.com','outlook.com','proton.me','fastmail.com'])}"
    phone = f"+1 ({rng.randint(200,989)}) {rng.randint(200,989)}-{rng.randint(1000,9999)}"
    github = f"github.com/{first.lower()}{last.lower()}"
    linkedin = f"linkedin.com/in/{first.lower()}-{last.lower()}"

    doc = Doc()
    L = Layout(doc, fam, accent)

    # ---- Header (randomized style) ----
    style = rng.choice(["band", "centered", "left"])
    name = f"{first} {last}"
    contacts = [city, email, phone, github, linkedin]
    if style == "band":
        doc.rect(0, PAGE_H - 92, PAGE_W, 92, accent)
        doc.text(MARGIN_X, PAGE_H - 50, name, heading_font, 22, (1, 1, 1))
        doc.text(MARGIN_X, PAGE_H - 68, full_title, fam[2], 11.5, (0.92, 0.92, 0.92))
        doc.text(MARGIN_X, PAGE_H - 84, "  |  ".join(contacts[:3]), fam[0], 8.5, (0.92, 0.92, 0.92))
        doc.text(PAGE_W - MARGIN_X - text_width("  |  ".join(contacts[3:]), fam[0], 8.5),
                 PAGE_H - 84, "  |  ".join(contacts[3:]), fam[0], 8.5, (0.92, 0.92, 0.92))
        L.y = PAGE_H - 92 - 16
    elif style == "centered":
        nw = text_width(name, heading_font, 22)
        doc.text((PAGE_W - nw) / 2, TOP - 6, name, heading_font, 22, accent)
        tw = text_width(full_title, fam[2], 11.5)
        doc.text((PAGE_W - tw) / 2, TOP - 24, full_title, fam[2], 11.5, (0.3, 0.3, 0.3))
        cline = "  |  ".join(contacts)
        cw = text_width(cline, fam[0], 8.5)
        doc.text((PAGE_W - cw) / 2, TOP - 38, cline, fam[0], 8.5, (0.4, 0.4, 0.4))
        L.y = TOP - 46
        L.rule(width=1.1)
    else:  # left
        doc.text(MARGIN_X, TOP - 6, name, heading_font, 22, accent)
        doc.text(MARGIN_X, TOP - 24, full_title, fam[2], 11.5, (0.3, 0.3, 0.3))
        for k, c in enumerate(["  |  ".join(contacts[:3]), "  |  ".join(contacts[3:])]):
            doc.text(MARGIN_X, TOP - 38 - 12 * k, c, fam[0], 8.5, (0.4, 0.4, 0.4))
        L.y = TOP - 58
        L.rule(width=1.1)

    # ---- Sections ----
    def sec_summary():
        L.heading("Professional Summary", heading_font)
        L.para(f"{full_title} with {years}+ years building production software across the "
               f"{track} stack. Comfortable owning features end to end, mentoring peers, and "
               f"partnering with product to ship measurable outcomes. Strong on testing, code "
               f"review, and pragmatic system design.")

    def sec_skills():
        L.heading("Technical Skills", heading_font)
        cats = STACK[track]
        mode = rng.choice(["table", "categorised", "inline"])
        if mode == "table":
            rows = [["Category", "Technologies"]]
            for cat, items in cats.items():
                pick = rng.sample(items, min(len(items), rng.randint(3, len(items))))
                rows.append([cat, ", ".join(pick)])
            L.table(rows, [0.28, 0.72])
        elif mode == "categorised":
            for cat, items in cats.items():
                pick = rng.sample(items, min(len(items), rng.randint(3, len(items))))
                L.para(f"{cat}: " + ", ".join(pick), size=9.5)
        else:
            allsk = list(dict.fromkeys(s for items in cats.values() for s in items))  # dedupe
            L.para(", ".join(rng.sample(allsk, min(len(allsk), 14))))

    def sec_experience():
        L.heading("Professional Experience", heading_font)
        end = 2025
        comps = rng.sample(COMPANIES, n_jobs)
        for j in range(n_jobs):
            start = end - spans[j]
            base = title if j == 0 else rng.choice([f[0] for f in FLAVORS])
            if j == 0:
                lvl = level_name
            elif j == n_jobs - 1:
                lvl = "Junior"  # career started junior
            else:
                lvl = rng.choice(["", "", "Senior"]) if level_name in ("Senior", "Lead") else ""
            L.kv_line((lvl + " " + base).strip(), f"{start} - {'Present' if j == 0 else end}")
            L.subtle(f"{comps[j]}  -  {rng.choice(CITIES)}")
            # Distinct objects per job so bullets in one role don't repeat.
            objs = OBJECTS[track][:]
            rng.shuffle(objs)
            lines = []
            for idx in range(rng.randint(5, 7)):
                o = objs[idx % len(objs)].format(n=rng.randint(4, 80), m=rng.randint(3, 40),
                                                 p=rng.randint(15, 60), fw=rng.choice(["React", "Vue", "Svelte"]))
                s = f"{rng.choice(VERBS)} {o}"
                if rng.random() < 0.7:
                    s += ", " + rng.choice(OUTCOMES).format(p=rng.randint(15, 65), t=rng.randint(70, 95),
                                                            n=rng.randint(2, 90))
                lines.append(s + ".")
            L.bullets(lines)
            L.gap(4)
            end = start

    def sec_projects():
        L.heading("Selected Projects", heading_font)
        for _ in range(rng.randint(3, 4)):
            pname = rng.choice(["Atlas", "Orbit", "Ledgerly", "Pulse", "Beacon", "Forge", "Harbor",
                                "Vertex", "Cascade", "Nimbus"]) + rng.choice(["", " CLI", " API", " App", "Kit"])
            L.kv_line(pname, rng.choice(["Open source", "Side project", "Client work"]))
            L.bullets([bullet(track, rng) for _ in range(rng.randint(2, 3))])
            L.gap(2)

    def sec_education():
        L.heading("Education", heading_font)
        grad = 2025 - years - rng.randint(0, 2)
        d1 = rng.choice(DEGREES)
        rows = [["Degree", "Institution", "Year"],
                [d1, f"{rng.choice(['','','Northgate ','Riverside ','Summit '])}{rng.choice(UNIS)}", str(grad)]]
        if rng.random() < 0.3:  # an earlier, distinct qualification
            d2 = rng.choice([d for d in DEGREES if d != d1])
            rows.append([d2, f"{rng.choice(UNIS)}", str(grad - rng.randint(2, 4))])
        L.table(rows, [0.42, 0.42, 0.16])

    def sec_certs():
        L.heading("Certifications", heading_font)
        L.bullets(rng.sample(CERTS, rng.randint(2, 3)))

    def sec_langs():
        L.heading("Languages", heading_font)
        L.para(",   ".join(rng.sample(LANGS, rng.randint(2, 3))))

    sec_summary()
    optional = [sec_skills, sec_projects, sec_education, sec_certs, sec_langs]
    rng.shuffle(optional)
    # Experience stays prominent (right after summary or skills); insert it early.
    order = [sec_skills] if rng.random() < 0.5 else []
    order.append(sec_experience)
    for s in optional:
        if s not in order:
            order.append(s)
    for s in order:
        s()

    return f"dev_{i:02d}_{last.lower()}.pdf", doc.build()


def main():
    out_dir = os.path.join(os.path.dirname(__file__), "resumes")
    os.makedirs(out_dir, exist_ok=True)
    for i in range(1, 21):
        fname, data = make_resume(i)
        with open(os.path.join(out_dir, fname), "wb") as f:
            f.write(data)
        print("wrote", fname, f"({len(data)} bytes)")


if __name__ == "__main__":
    main()
