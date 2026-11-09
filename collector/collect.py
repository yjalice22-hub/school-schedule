"""학교 목록과 학사일정 수집 (체크포인트 기반, 중단 후 재개 가능).

학사일정 조회 방식
  bulk   : 교육청 × 월 단위로 한꺼번에 조회 (호출 수가 적음)
  school : 학교 × 학년도 단위로 조회 (bulk가 지원되지 않을 때)
  auto   : bulk를 먼저 시도하고, NEIS가 학교코드를 필수로 요구하면(ERROR-300) school로 전환
bulk 조각이 재시도 끝에 실패하면 그 교육청·월은 학교별 조회로 다시 받고,
그래도 실패한 학교를 '실패 학교'로 기록합니다.
"""
import calendar
import datetime as dt
import gzip
import json
import os
import time
from pathlib import Path

from . import config
from .neis_client import DailyLimitError, MissingParamError, NeisError

KEEP_FIELDS = ["ATPT_OFCDC_SC_CODE", "SD_SCHUL_CODE", "SCHUL_NM", "AY", "DGHT_CRSE_SC_NM", "SCHUL_CRSE_SC_NM",
               "SBTR_DD_SC_NM", "AA_YMD", "EVENT_NM", "EVENT_CNTNT", *config.GRADE_FIELDS, "LOAD_DTM"]
SCHOOL_FIELDS = ["ATPT_OFCDC_SC_CODE", "ATPT_OFCDC_SC_NM", "SD_SCHUL_CODE", "SCHUL_NM", "SCHUL_KND_SC_NM",
                 "LCTN_SC_NM", "FOND_SC_NM", "HS_SC_NM", "HMPG_ADRES", "LOAD_DTM"]


def _now():
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=9)))


class Checkpoint:
    """cache/ 아래에 조각별 gzip JSON을 저장. max_age_hours 안에 받은 조각은 재사용합니다."""

    def __init__(self, root, max_age_hours=None):
        self.root = Path(root)
        self.max_age = (config.CACHE_MAX_AGE_HOURS if max_age_hours is None else max_age_hours) * 3600

    def path(self, *parts):
        return self.root.joinpath(*parts[:-1], parts[-1] + ".json.gz")

    def load(self, *parts):
        p = self.path(*parts)
        if not p.exists():
            return None
        try:
            with gzip.open(p, "rt", encoding="utf-8") as f:
                obj = json.load(f)
        except (OSError, json.JSONDecodeError):
            return None
        if time.time() - obj.get("ts", 0) > self.max_age:
            return None
        return obj["data"]

    def save(self, data, *parts):
        p = self.path(*parts)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        with gzip.open(tmp, "wt", encoding="utf-8") as f:
            json.dump({"ts": time.time(), "data": data}, f, ensure_ascii=False)
        os.replace(tmp, p)


def _slim(rows, fields):
    return [{k: r.get(k) for k in fields} for r in rows]


def collect_schools(client, ck, offices, log=print):
    """학교기본정보: 교육청 × 학교종류(초·중·고). 반환: 학교 dict 목록"""
    out = []
    for code, name in offices:
        for kind in config.LEVEL_BY_KIND:
            part = ("schools", code, kind)
            rows = ck.load(*part)
            if rows is None:
                rows = _slim(client.fetch_all("schoolInfo", {"ATPT_OFCDC_SC_CODE": code, "SCHUL_KND_SC_NM": kind}), SCHOOL_FIELDS)
                ck.save(rows, *part)
                log(f"  학교목록 {name} {kind}: {len(rows)}곳")
            out.extend(rows)
    return out


def _months(ay):
    for y, m in [(ay, mm) for mm in range(3, 13)] + [(ay + 1, mm) for mm in (1, 2)]:
        last = calendar.monthrange(y, m)[1]
        yield f"{y}{m:02d}", f"{y}{m:02d}01", f"{y}{m:02d}{last:02d}"


def _ay_range(ay):
    last = calendar.monthrange(ay + 1, 2)[1]
    return f"{ay}0301", f"{ay + 1}02{last:02d}"


def detect_mode(client, offices, ay, log=print):
    code = offices[0][0]
    try:
        client.fetch_all("SchoolSchedule", {"ATPT_OFCDC_SC_CODE": code, "AA_FROM_YMD": f"{ay}0301", "AA_TO_YMD": f"{ay}0307"})
        log("  교육청 단위 일괄 조회(bulk) 사용")
        return "bulk"
    except MissingParamError:
        log("  NEIS가 학교코드를 요구합니다 → 학교별 조회(school) 사용")
        return "school"


def collect_schedule(client, ck, ay, schools, offices, mode="auto", log=print):
    """반환: (rows, report). DailyLimitError는 그대로 올려 보냅니다(이미 받은 조각은 저장됨)."""
    report = {"mode": mode, "chunks": 0, "cached": 0, "fetched": 0, "fallback_chunks": 0, "failed_schools": []}
    if mode == "auto":
        mode = detect_mode(client, offices, ay, log)
        report["mode"] = mode
    by_office = {}
    for s in schools:
        by_office.setdefault(s["ATPT_OFCDC_SC_CODE"], []).append(s)
    rows, failed = [], set()

    def per_school(code, sc, frm, to, tag):
        part = ("sched", str(ay), "school", code, f"{sc['SD_SCHUL_CODE']}_{tag}")
        got = ck.load(*part)
        if got is not None:
            report["cached"] += 1
            return got
        try:
            got = _slim(client.fetch_all("SchoolSchedule", {"ATPT_OFCDC_SC_CODE": code, "SD_SCHUL_CODE": sc["SD_SCHUL_CODE"],
                                                            "AA_FROM_YMD": frm, "AA_TO_YMD": to}), KEEP_FIELDS)
        except DailyLimitError:
            raise
        except NeisError as e:
            log(f"    실패: {sc.get('SCHUL_NM')} ({sc['SD_SCHUL_CODE']}) {e}")
            failed.add(sc["SD_SCHUL_CODE"])
            return []
        ck.save(got, *part)
        report["fetched"] += 1
        return got

    for code, name in offices:
        office_schools = by_office.get(code, [])
        t0 = time.time()
        n0 = len(rows)
        if mode == "bulk":
            for tag, frm, to in _months(ay):
                report["chunks"] += 1
                part = ("sched", str(ay), "bulk", code, tag)
                got = ck.load(*part)
                if got is not None:
                    report["cached"] += 1
                    rows.extend(got)
                    continue
                try:
                    got = _slim(client.fetch_all("SchoolSchedule", {"ATPT_OFCDC_SC_CODE": code, "AA_FROM_YMD": frm, "AA_TO_YMD": to}), KEEP_FIELDS)
                    ck.save(got, *part)
                    report["fetched"] += 1
                    rows.extend(got)
                except DailyLimitError:
                    raise
                except NeisError as e:
                    log(f"  {name} {tag} 일괄 조회 실패({e}) → 학교별로 다시 받습니다")
                    report["fallback_chunks"] += 1
                    for sc in office_schools:
                        rows.extend(per_school(code, sc, frm, to, tag))
        else:
            frm, to = _ay_range(ay)
            for sc in office_schools:
                report["chunks"] += 1
                rows.extend(per_school(code, sc, frm, to, "ay"))
        log(f"  {ay}학년도 {name}: {len(rows) - n0:,}행 ({time.time() - t0:.0f}초)")
    report["failed_schools"] = sorted(failed)
    return rows, report
