"""把 docs/event-cards.md 的事件牌表格轉成 db/seed.sql。

用法：python tools/import_cards.py
修改事件牌清單後重新執行，再重啟 server.py 即會載入新內容。
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "event-cards.md"
OUT = ROOT / "db" / "seed.sql"

STAGES = {"Y": "youth", "M": "middle", "O": "elder"}
KINDS = {"機會": "chance", "命運": "fate"}
ROW = re.compile(r"^\|\s*([YMO])([1-6])-(\d{2})\s*\|(.+?)\|(.+?)\|\s*(機會|命運)\s*\|\s*$")
# 「−」(U+2212) 與一般減號都視為負號
EFFECT = re.compile(r"(現金|淨收入|健康)\s*([+\-−])\s*([\d,]+)")
FIELD = {"現金": "cash", "淨收入": "net_income", "健康": "health"}


def parse_effects(text, card_id):
    effects = {"cash": 0, "net_income": 0, "health": 0}
    parts = [p.strip() for p in re.split(r"[；;]", text) if p.strip()]
    for part in parts:
        m = EFFECT.search(part)
        if not m:
            raise ValueError(f"{card_id} 無法解析影響「{part}」")
        name, sign, num = m.groups()
        value = int(num.replace(",", ""))
        effects[FIELD[name]] += -value if sign in "-−" else value
    return effects


def sql_str(s):
    return "'" + s.replace("'", "''") + "'"


def main():
    rows, errors = [], []
    for line_no, line in enumerate(SRC.read_text(encoding="utf-8").splitlines(), 1):
        m = ROW.match(line)
        if not m:
            if re.match(r"^\|\s*[YMO]\d-\d", line):
                errors.append(f"第 {line_no} 行格式不符：{line}")
            continue
        stage, category, num, text, effect_text, kind = m.groups()
        card_id = f"{stage}{category}-{num}"
        try:
            eff = parse_effects(effect_text, card_id)
        except ValueError as e:
            errors.append(f"第 {line_no} 行：{e}")
            continue
        rows.append((card_id, STAGES[stage], KINDS[kind], int(category), text.strip(), eff))

    if errors:
        print("\n".join(errors), file=sys.stderr)
        sys.exit(1)

    ids = [r[0] for r in rows]
    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes:
        sys.exit(f"編號重複：{sorted(dupes)}")

    lines = [
        "-- 由 tools/import_cards.py 自 docs/event-cards.md 產生，請勿手動修改",
        "DELETE FROM cards;",
    ]
    for card_id, stage, kind, category, text, e in rows:
        lines.append(
            "INSERT INTO cards (id, stage, kind, category, text, cash, net_income, health) VALUES "
            f"({sql_str(card_id)}, '{stage}', '{kind}', {category}, {sql_str(text)}, {e['cash']}, {e['net_income']}, {e['health']});"
        )
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")

    summary = {}
    for _, stage, kind, *_ in rows:
        summary[(stage, kind)] = summary.get((stage, kind), 0) + 1
    print(f"已寫入 {len(rows)} 張牌到 {OUT.relative_to(ROOT)}")
    for (stage, kind), n in sorted(summary.items()):
        print(f"  {stage:7} {kind:7} {n}")


if __name__ == "__main__":
    main()
