"""날짜 분포 통계. 대시보드(JS)와 같은 정의를 씁니다.

사분위수: 선형보간(Hyndman–Fan type 7) = numpy.quantile(method="linear") = Excel QUARTILE.INC.
날짜를 일련번호(ordinal)로 바꿔 계산한 뒤 floor(x + 0.5)로 가장 가까운 날짜에 맞춥니다.
"""
import datetime as dt
import math


def ymd_to_ord(ymd):
    s = str(ymd)
    return dt.date(int(s[:4]), int(s[4:6]), int(s[6:8])).toordinal()


def ord_to_ymd(o):
    d = dt.date.fromordinal(int(o))
    return d.year * 10000 + d.month * 100 + d.day


def quantile(sorted_vals, p):
    h = (len(sorted_vals) - 1) * p
    lo = math.floor(h)
    hi = min(lo + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (h - lo) * (sorted_vals[hi] - sorted_vals[lo])


def rnd(x):
    return math.floor(x + 0.5)


def summarize(values):
    """values: 날짜 일련번호 목록 → dict 또는 None"""
    v = sorted(values)
    if not v:
        return None
    return {"n": len(v), "min": v[0], "q1": rnd(quantile(v, .25)), "med": rnd(quantile(v, .5)),
            "q3": rnd(quantile(v, .75)), "max": v[-1]}


def status_of(n, rate, thresh):
    if n == 0:
        return "none"
    if n < thresh["MIN_N"]:
        return "insufficient"
    if n < thresh["WARN_N"]:
        return "small"
    if rate is not None and rate < thresh["LOW_RATE"]:
        return "lowrate"
    return "ok"
