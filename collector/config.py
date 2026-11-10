"""수집기 설정. 값은 환경변수로 덮어쓸 수 있습니다."""
import os

# 인증키: 코드나 저장소에 절대 적지 마세요. GitHub Secrets 또는 내 PC 환경변수(NEIS_API_KEY)로만 넣습니다.
API_KEY = os.environ.get("NEIS_API_KEY", "").strip()
BASE_URL = os.environ.get("NEIS_BASE_URL", "https://open.neis.go.kr/hub").rstrip("/")

PAGE_SIZE = int(os.environ.get("NEIS_PAGE_SIZE", "1000"))          # NEIS 1회 최대 1,000건
REQUEST_INTERVAL = float(os.environ.get("NEIS_INTERVAL", "0.1"))   # 요청 시작 간 최소 간격(초) — 초당 최대 10회
MAX_RETRIES = int(os.environ.get("NEIS_MAX_RETRIES", "5"))
WORKERS = int(os.environ.get("NEIS_WORKERS", "6"))                 # 학교별 조회 동시 실행 수
PROBE_SIZE = int(os.environ.get("NEIS_PROBE_SIZE", "60"))          # 다음 학년도 탐색 조회 표본 학교 수
TIMEOUT = float(os.environ.get("NEIS_TIMEOUT", "30"))
CACHE_MAX_AGE_HOURS = float(os.environ.get("NEIS_CACHE_MAX_AGE_HOURS", "48"))  # 이 시간 안에 받은 조각은 재사용(중단 후 재개)

# 실패 학교 비율이 이 값을 넘으면 그 학년도 데이터는 덮어쓰지 않고 이전 데이터를 유지
MAX_FAILED_SCHOOL_RATIO = float(os.environ.get("NEIS_MAX_FAILED_RATIO", "0.01"))

OFFICES = [
    ("B10", "서울"), ("C10", "부산"), ("D10", "대구"), ("E10", "인천"), ("F10", "광주"),
    ("G10", "대전"), ("H10", "울산"), ("I10", "세종"), ("J10", "경기"), ("K10", "강원"),
    ("M10", "충북"), ("N10", "충남"), ("P10", "전북"), ("Q10", "전남"), ("R10", "경북"),
    ("S10", "경남"), ("T10", "제주"),
]
LEVEL_BY_KIND = {"초등학교": "E", "중학교": "M", "고등학교": "H"}
MAXG = {"E": 6, "M": 3, "H": 3}
GRADE_FIELDS = ["ONE_GRADE_EVENT_YN", "TW_GRADE_EVENT_YN", "THREE_GRADE_EVENT_YN",
                "FR_GRADE_EVENT_YN", "FIV_GRADE_EVENT_YN", "SIX_GRADE_EVENT_YN"]

# 통계 표시 기준 (대시보드와 동일해야 함)
THRESH = {"MIN_N": 5, "WARN_N": 20, "LOW_RATE": 0.5, "YEAR_COVERAGE": 0.30, "GAP_SPLIT": 14}
