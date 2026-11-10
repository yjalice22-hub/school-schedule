"""모의 NEIS API 서버 — 실제 NEIS에 접속하지 않고 수집기를 시험할 때 씁니다.

  python tools/mock/server.py --port 8765 [--fail-rate 0.05] [--daily-limit 300] [--require-school] [--fail-chunk J10:202605]
  NEIS_BASE_URL=http://127.0.0.1:8765/hub NEIS_API_KEY=mockkey python -m collector.run

응답 형식은 NEIS JSON과 같습니다: {"SchoolSchedule":[{"head":[{"list_total_count":N},{"RESULT":{...}}]},{"row":[...]}]}
"""
import argparse, json, random, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

ap = argparse.ArgumentParser()
ap.add_argument("--port", type=int, default=8765)
ap.add_argument("--data", default=str(Path(__file__).parent / "data"))
ap.add_argument("--key", default="mockkey")
ap.add_argument("--fail-rate", type=float, default=0.0)
ap.add_argument("--daily-limit", type=int, default=0)
ap.add_argument("--require-school", action="store_true")
ap.add_argument("--fail-chunk", default="")
ap.add_argument("--seed", type=int, default=1)
ap.add_argument("--delay", type=float, default=0.0, help="응답 지연(초) — 실제 NEIS 응답 속도 흉내")
A = ap.parse_args()
random.seed(A.seed)
D = {s: json.loads((Path(A.data) / f"{s}.json").read_text(encoding="utf-8")) for s in ("schoolInfo", "SchoolSchedule")}
IDX = {}
for r in D["SchoolSchedule"]:
    IDX.setdefault(r["ATPT_OFCDC_SC_CODE"], []).append(r)
LOCK = threading.Lock()
CALLS = {"n": 0}

def result(code, msg):
    return {"RESULT": {"CODE": code, "MESSAGE": msg}}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, obj, status=200):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status); self.send_header("Content-Type", "application/json;charset=UTF-8"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if A.delay: time.sleep(A.delay)
        u = urlparse(self.path); svc = u.path.rsplit("/", 1)[-1]; q = {k: v[0] for k, v in parse_qs(u.query).items()}
        with LOCK:
            CALLS["n"] += 1; n = CALLS["n"]
        if q.get("KEY") != A.key: return self.send(result("ERROR-290", "인증키가 유효하지 않습니다."))
        if A.daily_limit and n > A.daily_limit: return self.send(result("ERROR-337", "일별 트래픽 제한을 넘은 호출입니다."))
        if A.fail_rate and random.random() < A.fail_rate:
            return self.send({"error": "boom"}, 500) if random.random() < .5 else self.send(result("ERROR-500", "서버 오류입니다."))
        ps, pi = int(q.get("pSize", 100)), int(q.get("pIndex", 1))
        if ps > 1000: return self.send(result("ERROR-336", "데이터요청은 한번에 최대 1,000건을 넘을 수 없습니다"))
        if svc == "schoolInfo":
            rows = [r for r in D["schoolInfo"] if (not q.get("ATPT_OFCDC_SC_CODE") or r["ATPT_OFCDC_SC_CODE"] == q["ATPT_OFCDC_SC_CODE"]) and (not q.get("SCHUL_KND_SC_NM") or r["SCHUL_KND_SC_NM"] == q["SCHUL_KND_SC_NM"])]
        elif svc == "SchoolSchedule":
            if not q.get("ATPT_OFCDC_SC_CODE") or (A.require_school and not q.get("SD_SCHUL_CODE")):
                return self.send(result("ERROR-300", "필수 값이 누락되어 있습니다."))
            if A.fail_chunk and not q.get("SD_SCHUL_CODE"):
                oc, ym = A.fail_chunk.split(":")
                if q["ATPT_OFCDC_SC_CODE"] == oc and q.get("AA_FROM_YMD", "").startswith(ym):
                    return self.send(result("ERROR-500", "서버 오류입니다."))
            lo, hi = q.get("AA_FROM_YMD", "00000000"), q.get("AA_TO_YMD", "99999999")
            rows = [r for r in IDX.get(q["ATPT_OFCDC_SC_CODE"], []) if lo <= r["AA_YMD"] <= hi and (not q.get("SD_SCHUL_CODE") or r["SD_SCHUL_CODE"] == q["SD_SCHUL_CODE"])]
        else:
            return self.send(result("ERROR-310", "해당하는 서비스를 찾을 수 없습니다."))
        if not rows: return self.send(result("INFO-200", "해당하는 데이터가 없습니다."))
        page = rows[(pi - 1) * ps: pi * ps]
        if not page: return self.send(result("INFO-200", "해당하는 데이터가 없습니다."))
        self.send({svc: [{"head": [{"list_total_count": len(rows)}, {"RESULT": {"CODE": "INFO-000", "MESSAGE": "정상 처리되었습니다."}}]}, {"row": page}]})

print(f"mock NEIS on :{A.port}", flush=True)
ThreadingHTTPServer(("127.0.0.1", A.port), H).serve_forever()
