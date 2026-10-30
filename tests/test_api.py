"""API 測試。使用 tests/fixtures/sample_weirs.csv (虛構的測試資料，不含真實石滬座標)。

需要一個空的測試資料庫：

    TEST_DATABASE_URL=postgresql://user:pw@localhost:5432/weirs_test pytest

沒設定 TEST_DATABASE_URL 時，這些測試會自動跳過。
"""
import os
import sys

import pytest

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
FIXTURE = os.path.join(HERE, "fixtures", "sample_weirs.csv")

TEST_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not TEST_URL, reason="未設定 TEST_DATABASE_URL")


@pytest.fixture(scope="module")
def client():
    os.environ["DATABASE_URL"] = TEST_URL
    import db
    import import_csv
    from app import app

    db.init_db()
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute("TRUNCATE stone_weirs")
    import_csv.import_csv(FIXTURE)
    return app.test_client()


def test_import_is_idempotent(client):
    import import_csv
    import_csv.import_csv(FIXTURE)               # 再匯入一次不應該產生重複資料
    assert client.get("/api/weirs").get_json()["count"] == 6


def test_list_weirs(client):
    body = client.get("/api/weirs").get_json()
    assert body["success"] is True
    assert body["count"] == 6
    assert {"id", "type", "lat", "lng", "mlwn_ok"} <= body["data"][0].keys()


def test_empty_values_become_null(client):
    w = client.get("/api/weirs/T006").get_json()["data"]
    assert w["name"] is None and w["pool_score"] is None and w["isle_score"] is None


def test_filter_by_type(client):
    body = client.get("/api/weirs?type=曲線形").get_json()
    assert body["count"] == 3
    assert all(w["type"] == "曲線形" for w in body["data"])


def test_filter_mlwn_ok(client):
    assert client.get("/api/weirs?mlwn_ok=true").get_json()["count"] == 3
    assert client.get("/api/weirs?mlwn_ok=false").get_json()["count"] == 3


def test_pagination(client):
    assert client.get("/api/weirs?limit=5&offset=4").get_json()["count"] == 2


@pytest.mark.parametrize("query", ["limit=0", "limit=abc", "offset=-1", "mlwn_ok=maybe"])
def test_bad_list_params_return_400(client, query):
    assert client.get(f"/api/weirs?{query}").status_code == 400


def test_weir_detail(client):
    body = client.get("/api/weirs/T001").get_json()
    assert body["data"]["name"] == "測試一"
    assert abs(body["data"]["lng"] - 119.0) < 1e-9


def test_weir_detail_not_found(client):
    res = client.get("/api/weirs/NOPE")
    assert res.status_code == 404 and res.get_json()["success"] is False


def test_nearby_sorted_and_within_radius(client):
    body = client.get("/api/weirs/nearby?lat=23.0&lng=119.0&radius=500").get_json()
    assert [w["id"] for w in body["data"]] == ["T001", "T002"]
    assert body["data"][0]["distance_m"] < 1
    assert 95 < body["data"][1]["distance_m"] < 110      # 經度差 0.001° 在北緯 23° 約 102 公尺


def test_nearby_larger_radius(client):
    body = client.get("/api/weirs/nearby?lat=23.0&lng=119.0&radius=2000").get_json()
    assert [w["id"] for w in body["data"]] == ["T001", "T002", "T003"]


def test_nearby_far_away_is_empty(client):
    assert client.get("/api/weirs/nearby?lat=25.03&lng=121.56&radius=1000").get_json()["count"] == 0


@pytest.mark.parametrize("query", ["lat=23.7", "lat=99&lng=119", "lat=a&lng=b", "lat=23&lng=119&radius=0"])
def test_nearby_validation(client, query):
    assert client.get(f"/api/weirs/nearby?{query}").status_code == 400


def test_stats(client):
    data = client.get("/api/stats").get_json()["data"]
    assert sum(r["total"] for r in data) == 6
    assert sum(r["mlwn_ok_count"] for r in data) == 3


def test_bulk_download_endpoint_is_removed(client):
    assert client.get("/api/weirs.geojson").status_code == 404


def test_homepage_and_static_files(client):
    assert client.get("/").status_code == 200
    assert client.get("/js/script.js").status_code == 200
    for hidden in ("/app.py", "/db.py", "/data/stone_weirs.csv", "/tests/fixtures/sample_weirs.csv"):
        assert client.get(hidden).status_code == 404     # 程式碼與資料檔不會被當成靜態檔案公開
