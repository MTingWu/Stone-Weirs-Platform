"""澎湖吉貝石滬互動地圖平台 — Flask 後端。

- 提供 REST API (資料來自 PostgreSQL/PostGIS)
- 同時負責提供前端靜態檔案 (public/ 資料夾)
"""
from flask import Flask, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException

import db

app = Flask(__name__, static_folder="public", static_url_path="")
app.json.ensure_ascii = False   # JSON 直接輸出中文，不要變成 \uXXXX
app.json.sort_keys = False

try:
    db.init_db()
except Exception as e:           # 資料庫暫時連不上，也不要讓整個網站起不來
    print(f"資料庫初始化失敗: {e}")


def error(message, status):
    return jsonify({"success": False, "error": message}), status


@app.before_request
def require_database():
    if request.path.startswith("/api/") and not db.enabled():
        return error("尚未設定資料庫 (DATABASE_URL)", 503)


@app.errorhandler(Exception)
def handle_unexpected(e):
    if isinstance(e, HTTPException):
        if request.path.startswith("/api/"):
            return error(e.description, e.code)
        return e
    app.logger.exception("未預期的錯誤")
    return error("伺服器發生錯誤", 500)


def number_arg(name, cast=float, default=None, lo=None, hi=None):
    """讀取並驗證數字參數；不合法就丟 ValueError。"""
    raw = request.args.get(name)
    if raw is None:
        if default is None:
            raise ValueError(f"缺少參數 {name}")
        return default
    try:
        value = cast(raw)
    except ValueError:
        raise ValueError(f"參數 {name} 必須是數字")
    if (lo is not None and value < lo) or (hi is not None and value > hi):
        raise ValueError(f"參數 {name} 超出範圍 ({lo} ~ {hi})")
    return value


# ---------- 頁面 ----------
@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


# ---------- API ----------
@app.route("/api/weirs")
def weirs():
    """列出石滬。可用 ?type=曲線形 &mlwn_ok=true 篩選，並用 limit / offset 分頁。"""
    try:
        limit = number_arg("limit", int, default=500, lo=1, hi=1000)
        offset = number_arg("offset", int, default=0, lo=0)
    except ValueError as e:
        return error(str(e), 400)

    mlwn_ok = request.args.get("mlwn_ok")
    if mlwn_ok not in (None, "true", "false"):
        return error("mlwn_ok 必須是 true 或 false", 400)

    data = db.list_weirs(
        weir_type=request.args.get("type"),
        mlwn_ok=None if mlwn_ok is None else mlwn_ok == "true",
        limit=limit, offset=offset,
    )
    return jsonify({"success": True, "count": len(data), "data": data})


@app.route("/api/weirs/nearby")
def weirs_nearby():
    """找附近石滬: /api/weirs/nearby?lat=23.74&lng=119.61&radius=500 (單位：公尺)"""
    try:
        lat = number_arg("lat", float, lo=-90, hi=90)
        lng = number_arg("lng", float, lo=-180, hi=180)
        radius = number_arg("radius", float, default=500, lo=1, hi=50000)
        limit = number_arg("limit", int, default=20, lo=1, hi=200)
    except ValueError as e:
        return error(str(e), 400)
    data = db.nearby(lat, lng, radius, limit)
    return jsonify({"success": True, "count": len(data), "data": data})


@app.route("/api/weirs/<weir_id>")
def weir_detail(weir_id):
    weir = db.get_weir(weir_id)
    if weir is None:
        return error(f"找不到石滬 {weir_id}", 404)
    return jsonify({"success": True, "data": weir})


@app.route("/api/stats")
def stats():
    return jsonify({"success": True, "data": db.stats()})


if __name__ == "__main__":
    app.run(debug=True, port=5000)
