"""把 data/stone_weirs.csv 匯入資料庫 (可重複執行：已存在的會更新)。

用法:
    DATABASE_URL=postgresql://... python scripts/import_csv.py [csv路徑]
"""
import csv
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import db  # noqa: E402

DEFAULT_CSV = os.path.join(os.path.dirname(__file__), "..", "data", "stone_weirs.csv")


def _num(value):
    """空字串 → None，其餘轉成 float。"""
    value = (value or "").strip()
    return float(value) if value else None


def import_csv(path=DEFAULT_CSV):
    db.init_db()
    rows = []
    with open(path, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            if not r["ID"].strip():
                continue
            rows.append((
                r["ID"].strip(), (r["名稱"] or "").strip() or None,
                r["Type"].strip(), r["Local Status"].strip() or None,
                r["MLWN"].strip() or None, r["MHWN"].strip() or None,
                _num(r["Pool_Score"]), _num(r["Wall_Score"]),
                _num(r["Expo_Score"]), _num(r["isle"]),
                r["MLWN_check"].strip() == "1",
                "完全" in r["MHWN"],                 # 判斷規則與原本前端相同
                float(r["Longtitude"]), float(r["Latitude"]),  # CSV 欄位名稱原本就拼成 Longtitude
            ))

    with db.connect() as conn, conn.cursor() as cur:
        for row in rows:
            cur.execute(
                """
                INSERT INTO stone_weirs
                  (id, name, weir_type, local_status, mlwn_status, mhwn_status,
                   pool_score, wall_score, expo_score, isle_score, mlwn_ok, mhwn_ok, geom)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                        ST_SetSRID(ST_MakePoint(%s, %s), 4326))
                ON CONFLICT (id) DO UPDATE SET
                  name = EXCLUDED.name, weir_type = EXCLUDED.weir_type,
                  local_status = EXCLUDED.local_status,
                  mlwn_status = EXCLUDED.mlwn_status, mhwn_status = EXCLUDED.mhwn_status,
                  pool_score = EXCLUDED.pool_score, wall_score = EXCLUDED.wall_score,
                  expo_score = EXCLUDED.expo_score, isle_score = EXCLUDED.isle_score,
                  mlwn_ok = EXCLUDED.mlwn_ok, mhwn_ok = EXCLUDED.mhwn_ok,
                  geom = EXCLUDED.geom;
                """,
                row,
            )
    return len(rows)


if __name__ == "__main__":
    if not db.enabled():
        sys.exit("請先設定環境變數 DATABASE_URL")
    n = import_csv(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_CSV)
    print(f"已匯入 {n} 筆石滬資料")
