"""NEIS 교육정보 개방 포털 API 클라이언트.

- 페이지네이션(pIndex/pSize), 호출 간격 조절, 지수 백오프 재시도
- 결과 코드 해석: INFO-200(데이터 없음)은 빈 목록, ERROR-337(일일 트래픽 초과)은 즉시 중단,
  인증 오류는 치명적 오류, 서버 오류(ERROR-500/600/601)·네트워크 오류는 재시도
표준 라이브러리만 사용합니다.
"""
import json
import random
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from . import config

RETRYABLE_CODES = {"ERROR-500", "ERROR-600", "ERROR-601"}
AUTH_CODES = {"ERROR-290", "INFO-300", "ERROR-310"}


class NeisError(Exception):
    def __init__(self, code, message):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


class DailyLimitError(NeisError):
    """일일 호출 한도 초과. 지금까지 받은 조각은 저장되어 있으므로 다음 실행에서 이어 받습니다."""


class AuthError(NeisError):
    """인증키 오류. 재시도해도 소용없으므로 즉시 종료합니다."""


class MissingParamError(NeisError):
    """필수 요청값 누락(ERROR-300). 교육청 단위 일괄 조회를 지원하지 않는 경우 학교별 조회로 전환하는 데 씁니다."""


class NeisClient:
    def __init__(self, key=None, base_url=None, interval=None, retries=None, page_size=None, log=print):
        self.key = key if key is not None else config.API_KEY
        self.base = (base_url or config.BASE_URL).rstrip("/")
        self.interval = config.REQUEST_INTERVAL if interval is None else interval
        self.retries = config.MAX_RETRIES if retries is None else retries
        self.page_size = page_size or config.PAGE_SIZE
        self.log = log
        self._last = 0.0
        self._lock = threading.Lock()
        self.calls = 0
        self.retried = 0

    # ---------- 저수준 요청 ----------
    def _throttle(self):
        # 여러 스레드가 동시에 호출해도 요청 시작 간격은 interval 이상 유지
        with self._lock:
            now = time.monotonic()
            start = max(now, self._last + self.interval)
            self._last = start
            self.calls += 1
        if start > now:
            time.sleep(start - now)

    def _request(self, service, params):
        q = {"KEY": self.key, "Type": "json", **params}
        url = f"{self.base}/{service}?{urllib.parse.urlencode(q)}"
        attempt = 0
        while True:
            attempt += 1
            self._throttle()
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "school-schedule-collector/1.0"})
                with urllib.request.urlopen(req, timeout=config.TIMEOUT) as r:
                    body = r.read().decode("utf-8")
                data = json.loads(body)
                return self._parse(service, data)
            except (DailyLimitError, AuthError, MissingParamError):
                raise
            except NeisError as e:
                if e.code not in RETRYABLE_CODES or attempt > self.retries:
                    raise
                err = e
            except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError, OSError) as e:
                if isinstance(e, urllib.error.HTTPError) and e.code < 500 and e.code != 429:
                    raise NeisError(f"HTTP-{e.code}", str(e))
                if attempt > self.retries:
                    raise NeisError("NETWORK", str(e))
                err = e
            delay = min(60, 2 ** attempt) + random.uniform(0, 1)
            with self._lock:
                self.retried += 1
            self.log(f"  재시도 {attempt}/{self.retries} ({err}) — {delay:.1f}초 후")
            time.sleep(delay)

    @staticmethod
    def _parse(service, data):
        """반환: (total, rows). 데이터 없음이면 (0, [])."""
        if service in data:
            sections = data[service]
            head = next((s["head"] for s in sections if "head" in s), [])
            rows = next((s["row"] for s in sections if "row" in s), [])
            total = 0
            code, msg = "INFO-000", ""
            for h in head:
                if "list_total_count" in h:
                    total = int(h["list_total_count"])
                if "RESULT" in h:
                    code, msg = h["RESULT"].get("CODE", ""), h["RESULT"].get("MESSAGE", "")
            if code == "INFO-200":
                return 0, []
            if code != "INFO-000":
                NeisClient._raise(code, msg)
            return total, rows
        res = data.get("RESULT") or {}
        code, msg = res.get("CODE", "UNKNOWN"), res.get("MESSAGE", "")
        if code == "INFO-200":
            return 0, []
        NeisClient._raise(code, msg)

    @staticmethod
    def _raise(code, msg):
        if code == "ERROR-337":
            raise DailyLimitError(code, msg)
        if code in AUTH_CODES:
            raise AuthError(code, msg)
        if code == "ERROR-300":
            raise MissingParamError(code, msg)
        raise NeisError(code, msg)

    # ---------- 페이지네이션 ----------
    def fetch_all(self, service, params):
        rows, page, total = [], 1, None
        while True:
            try:
                t, chunk = self._request(service, {**params, "pIndex": page, "pSize": self.page_size})
            except NeisError as e:
                if e.code == "ERROR-336" and self.page_size > 100:   # 한 번에 요청 가능한 건수 초과
                    self.log("  pSize를 100으로 낮춰 다시 요청합니다")
                    self.page_size = 100
                    rows, page, total = [], 1, None
                    continue
                raise
            if total is None:
                total = t
            rows.extend(chunk)
            if not chunk or len(rows) >= total or len(chunk) < self.page_size:
                break
            page += 1
        return rows
