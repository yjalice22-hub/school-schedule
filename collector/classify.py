"""행사명 분류 규칙.

docs/index.html 안의 대시보드는 이 결과(분류·시험 기간)를 그대로 받아 통계를 냅니다.
규칙을 고치면 collector/tests/test_classify.py 의 사례도 함께 고치세요.

반환 cat:
  EXAM(정기 지필) | EXAM_REVIEW(종류 불명) | MOCK | DIAG | ACHIEVE | FORMATIVE | ENTRANCE | OPENING
  VAC_START | VACATION | CLOSING | GRAD | DISCRETION | HOLIDAY | OTHER
"""
import re
from functools import lru_cache

_STRIP = re.compile(r"\(.*?\)|\[.*?\]|\s")
_SEM = re.compile(r"([12])\s*학기")
_ORD1 = re.compile(r"제?([1-9])(차|회)(지필|정기|고사|평가|시험)")
_ORD2 = re.compile(r"제?([1-9])(차|회)")

RULES = [  # (정규식, cat, type, conf, rule)  — 위에서부터 먼저 맞는 규칙 적용
    (r"공휴일|대체휴일|토요휴업", "HOLIDAY", None, "high", "공휴일"),
    (r"모의고사|모의평가|학력평가|수능|수학능력", "MOCK", None, "high", "모의·학력평가 키워드"),
    (r"진단평가|진단검사|기초학력", "DIAG", None, "high", "진단 키워드"),
    (r"학업성취도|성취도평가|자율평가", "ACHIEVE", None, "high", "학업성취도 키워드"),
    (r"수행평가|재시험|결시|이의신청|채점|성적|정답|출제|감독|평가회|협의|연수|원안|대비|확인|공개|설명회", "OTHER", None, "high", "시험 부속 행사 제외"),
    (r"입학식", "ENTRANCE", None, "high", ""),
    (r"졸업식", "GRAD", None, "high", ""),
    (r"재량휴업|재량휴일", "DISCRETION", None, "high", ""),
    (r"방학식", "VAC_START", None, "high", ""),
    (r"방학", "VACATION", None, "high", ""),
    (r"종업식|수료식", "CLOSING", None, "high", ""),
    (r"개학|시업식", "OPENING", None, "high", ""),
    (r"형성평가|단원평가", "FORMATIVE", None, "high", ""),
]
RULES = [(re.compile(p), *rest) for p, *rest in RULES]


@lru_cache(maxsize=None)
def classify_name(raw, level):
    """raw: EVENT_NM, level: 'E'|'M'|'H' → dict(cat, type, sem_name, conf, rule)"""
    n = _STRIP.sub("", raw or "")
    m = _SEM.search(raw or "")
    sem_name = int(m.group(1)) if m else None

    def R(cat, typ=None, conf="high", rule=""):
        return {"cat": cat, "type": typ, "sem_name": sem_name, "conf": conf, "rule": rule}

    for rx, cat, typ, conf, rule in RULES:
        if rx.search(n):
            return R(cat, typ, conf, rule)
    if level == "E" and "학기말평가" in n:
        return R("FORMATIVE", None, "high", "초등 학기말 평가")
    if re.search(r"중간고사|중간평가|중간시험", n):
        return R("EXAM", "MID", "high", '"중간" 명시')
    if re.search(r"기말고사|기말평가|기말시험|학기말고사", n):
        return R("EXAM", "FINAL", "high", '"기말" 명시')
    m = _ORD1.search(n) or (re.search(r"지필|고사", n) and _ORD2.search(n))
    if m:
        k = int(m.group(1))
        if k == 1:
            return R("EXAM", "MID", "medium", "서수 1차/1회 → 중간(추정)")
        if k == 2:
            return R("EXAM", "FINAL", "medium", "서수 2차/2회 → 기말(추정)")
        return R("EXAM_REVIEW", None, "low", f"서수 {k}차 — 중간/기말 판단 불가")
    if re.search(r"지필|정기고사|정기시험|정기평가", n):
        return R("EXAM_REVIEW", None, "low", "시험 종류 표기 없음")
    return R("OTHER", None, "high", "")


def sem_of_date(ymd):
    """3~7월 → 1학기, 8~2월 → 2학기"""
    m = int(str(ymd)[4:6])
    return 1 if 3 <= m <= 7 else 2
