"""PostgreSQL / PostGIS 存取層：石滬資料的建表與查詢。"""
import os
from contextlib import contextmanager

import psycopg2
import psycopg2.extras


def database_url():
    return os.environ.get("DATABASE_URL")


def enabled():
    return bool(database_url())


@contextmanager
def connect():
    """開一條連線；成功就 commit、失敗就 rollback，最後一定關閉。"""
    conn = psycopg2.connect(database_url())
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


SCHEMA_SQL = """
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS stone_weirs (
    id            TEXT PRIMARY KEY,
    name          TEXT,
    weir_type     TEXT NOT NULL,
    local_status  TEXT,
    mlwn_status   TEXT,
    mhwn_status   TEXT,
    pool_score    DOUBLE PRECISION,
    wall_score    DOUBLE PRECISION,
    expo_score    DOUBLE PRECISION,
    isle_score    DOUBLE PRECISION,
    mlwn_ok       BOOLEAN NOT NULL,
    mhwn_ok       BOOLEAN NOT NULL,
    geom          geometry(Point, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stone_weirs_type ON stone_weirs (weir_type);
-- geometry 欄位做一般空間查詢；geography 運算式索引給「公尺」距離查詢用
CREATE INDEX IF NOT EXISTS idx_stone_weirs_geom ON stone_weirs USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_stone_weirs_geog ON stone_weirs USING GIST ((geom::geography));
"""


def init_db():
    if not enabled():
        return
    with connect() as conn, conn.cursor() as cur:
        cur.execute(SCHEMA_SQL)


COLUMNS = """
    id, name, weir_type AS type, local_status, mlwn_status, mhwn_status,
    pool_score, wall_score, expo_score, isle_score, mlwn_ok, mhwn_ok,
    ST_Y(geom) AS lat, ST_X(geom) AS lng
"""


def _fetch(sql, params=()):
    with connect() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def list_weirs(weir_type=None, mlwn_ok=None, limit=500, offset=0):
    where, params = [], []
    if weir_type:
        where.append("weir_type = %s")
        params.append(weir_type)
    if mlwn_ok is not None:
        where.append("mlwn_ok = %s")
        params.append(mlwn_ok)
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    return _fetch(
        f"SELECT {COLUMNS} FROM stone_weirs {clause} ORDER BY id LIMIT %s OFFSET %s",
        (*params, limit, offset),
    )


def get_weir(weir_id):
    rows = _fetch(f"SELECT {COLUMNS} FROM stone_weirs WHERE id = %s", (weir_id,))
    return rows[0] if rows else None


def nearby(lat, lng, radius_m, limit=20):
    """找出某座標 radius_m 公尺內的石滬，由近到遠排序 (PostGIS geography 距離)。"""
    return _fetch(
        f"""
        SELECT {COLUMNS},
               ROUND(ST_Distance(geom::geography,
                     ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::geography)::numeric, 1)::float8
                 AS distance_m
        FROM stone_weirs
        WHERE ST_DWithin(geom::geography,
                         ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::geography,
                         %(radius)s)
        ORDER BY distance_m
        LIMIT %(limit)s
        """,
        {"lat": lat, "lng": lng, "radius": radius_m, "limit": limit},
    )


def stats():
    """各類型的數量與狀況良好的數量 (取代前端自己算)。"""
    return _fetch(
        """
        SELECT weir_type AS type,
               COUNT(*)::int                         AS total,
               (COUNT(*) FILTER (WHERE mlwn_ok))::int AS mlwn_ok_count,
               (COUNT(*) FILTER (WHERE mhwn_ok))::int AS mhwn_ok_count
        FROM stone_weirs
        GROUP BY weir_type
        ORDER BY total DESC
        """
    )
