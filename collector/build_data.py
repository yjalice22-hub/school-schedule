"""원자료 → 대시보드용 JSON.

처리 순서
 1) 학년도·주간과정·초중고만 남기고 같은 행 중복 제거
 2) 행사명 분류(classify.py)
 3) 학교·학기·시험종류·학년별로 시험 기간(에피소드) 묶기 → 날짜가 14일 넘게 떨어지면 분리·검토
 4) 맥락 검사: 서수(1차/2차) 추정이 순서·시기와 맞지 않으면 검토
 5) 학교별 주요 일정(개학·방학·졸업 등), 캘린더용 이벤트, 학교 상세용 원자료
 6) 검증용 통계(stats.json) — 대시보드가 같은 값을 다시 계산해 일치 여부를 표시합니다
"""
import datetime as dt
import json
from collections import OrderedDict
from pathlib import Path

from . import config
from .classify import classify_event, grades_in_name, sem_of_date
from .stats import summarize, status_of, ymd_to_ord, ord_to_ymd

OFFICE_ORDER = {c: i for i, (c, _) in enumerate(config.OFFICES)}
TYPE_IDX = {"MID": 0, "FINAL": 1, "UNK": 2}
EVENT_CATS = ["VACATION", "VAC_START", "OPENING", "ENTRANCE", "GRAD", "CLOSING", "DISCRETION", "DIAG", "ACHIEVE", "FORMATIVE", "MOCK"]
RAW_CATS = ["EXAM", "EXAM_REVIEW", "MOCK", "DIAG", "ACHIEVE", "FORMATIVE", "ENTRANCE", "OPENING", "VAC_START", "VACATION",
            "CLOSING", "GRAD", "DISCRETION", "HOLIDAY", "OTHER"]
MS_KEYS = ["open1", "entrance", "summer", "open2", "winter", "grad", "closing", "diag", "achieve", "formative"]


class Interner:
    def __init__(self):
        self.map, self.list = {}, []

    def __call__(self, s):
        s = s or ""
        if s not in self.map:
            self.map[s] = len(self.list)
            self.list.append(s)
        return self.map[s]


def _ay_of(ymd):
    y, m = int(str(ymd)[:4]), int(str(ymd)[4:6])
    return y if m >= 3 else y - 1


def _mask(r, maxg=6):
    return sum(1 << i for i, f in enumerate(config.GRADE_FIELDS[:maxg]) if (r.get(f) or "").strip().upper() == "Y")


def build_year(ay, school_info, rows, failed_codes=()):
    """반환: dict(파일이름 → 객체), summary"""
    TH = config.THRESH
    failed_codes = set(failed_codes)
    # ---------- 학교 목록 ----------
    reg = {}
    for s in school_info:
        lv = config.LEVEL_BY_KIND.get(s.get("SCHUL_KND_SC_NM"))
        if not lv or s.get("ATPT_OFCDC_SC_CODE") not in OFFICE_ORDER:
            continue
        reg[s["SD_SCHUL_CODE"]] = {"code": s["SD_SCHUL_CODE"], "name": s.get("SCHUL_NM") or "", "region": s["ATPT_OFCDC_SC_CODE"],
                                   "level": lv, "hs": s.get("HS_SC_NM") or "", "homepage": (s.get("HMPG_ADRES") or "").strip(),
                                   "load": s.get("LOAD_DTM") or "", "inInfo": 1}
    # ---------- 행 정리 ----------
    clean, seen = [], set()
    for r in rows:
        ymd = str(r.get("AA_YMD") or "")
        if len(ymd) != 8:
            continue
        a = int(r["AY"]) if str(r.get("AY") or "").isdigit() else _ay_of(ymd)
        if a != ay:
            continue
        if (r.get("DGHT_CRSE_SC_NM") or "주간") not in ("주간", ""):
            continue
        code = r.get("SD_SCHUL_CODE")
        if code in failed_codes:
            continue
        if code not in reg:
            lv = config.LEVEL_BY_KIND.get(r.get("SCHUL_CRSE_SC_NM"))
            if not lv or r.get("ATPT_OFCDC_SC_CODE") not in OFFICE_ORDER:
                continue
            reg[code] = {"code": code, "name": r.get("SCHUL_NM") or "", "region": r["ATPT_OFCDC_SC_CODE"], "level": lv,
                         "hs": "", "homepage": "", "load": "", "inInfo": 0}
        s = reg[code]
        if r.get("LOAD_DTM") and r["LOAD_DTM"] > s.get("schedLoad", ""):
            s["schedLoad"] = r["LOAD_DTM"]
        mask = _mask(r, config.MAXG[s["level"]])
        key = (code, ymd, r.get("EVENT_NM") or "", mask)
        if key in seen:
            continue
        seen.add(key)
        clean.append({"code": code, "ymd": int(ymd), "ord": ymd_to_ord(ymd), "name": (r.get("EVENT_NM") or "").strip(),
                      "content": (r.get("EVENT_CNTNT") or "").strip(), "g": mask, "h": 1 if r.get("SBTR_DD_SC_NM") == "휴업일" else 0})
    for c in failed_codes:
        reg.pop(c, None)
    schools = sorted(reg.values(), key=lambda s: (OFFICE_ORDER[s["region"]], "EMH".index(s["level"]), s["name"], s["code"]))
    idx = {s["code"]: i for i, s in enumerate(schools)}
    clean.sort(key=lambda r: (idx[r["code"]], r["ymd"], r["name"], r["g"]))

    # ---------- 분류 ----------
    for r in clean:
        s = schools[idx[r["code"]]]
        k = classify_event(r["name"], r["content"], s["level"])
        r["si"] = idx[r["code"]]
        # 행사명에 학년이 적혀 있으면(예: "기말고사(3학년)") 학년별 행사 여부보다 행사명을 따른다.
        # 실제 NEIS에서 "(3학년)" 행인데 학년 표시는 전 학년 Y인 경우가 많았다.
        r["gm"] = r["g"]
        if k["cat"] in ("EXAM", "EXAM_REVIEW"):
            gn = grades_in_name(r["name"], config.MAXG[s["level"]])
            if gn and gn != r["g"]:
                r["gm"] = gn
                k = {**k, "rule": (k["rule"] + " · " if k["rule"] else "") + "학년은 행사명 표기 사용"}
        r["k"] = k
        ds = sem_of_date(r["ymd"])
        r["sem"] = k["sem_name"] or ds
        r["note"] = "학기 표기와 날짜 불일치" if k["sem_name"] and k["sem_name"] != ds else ""

    # ---------- 시험 기간 묶기 ----------
    groups = OrderedDict()
    for r in clean:
        if r["k"]["cat"] not in ("EXAM", "EXAM_REVIEW"):
            continue
        s = schools[r["si"]]
        typ = r["k"]["type"] if r["k"]["cat"] == "EXAM" else "UNK"
        grades = [g for g in range(1, config.MAXG[s["level"]] + 1) if r["gm"] & (1 << (g - 1))] or [0]
        for g in grades:
            key = (r["si"], r["sem"], typ, g)
            e = groups.get(key)
            if e is None:
                e = groups[key] = {"dates": set(), "names": set(), "name_dates": set(), "rules": [], "notes": set()}
            e["dates"].add(r["ord"])
            e["names"].add(r["name"])
            e["name_dates"].add((r["name"], r["ord"]))
            if r["k"]["rule"] not in e["rules"]:
                e["rules"].append(r["k"]["rule"])
            if r["note"]:
                e["notes"].add(r["note"])
    episodes = []
    for (si, sem, typ, g), e in groups.items():
        ds = sorted(e["dates"])
        pieces, cur = [], [ds[0]]
        for a, b in zip(ds, ds[1:]):
            if b - a > TH["GAP_SPLIT"]:
                pieces.append(cur)
                cur = [b]
            else:
                cur.append(b)
        pieces.append(cur)
        for i, p in enumerate(pieces):
            names_p = sorted({nm for nm, d in e["name_dates"] if p[0] <= d <= p[-1]}) or sorted(e["names"])
            episodes.append({"si": si, "sem": sem, "type": typ, "grade": g, "start": p[0], "end": p[-1], "days": len(p),
                             "dates": p, "names": names_p, "rule": " / ".join(e["rules"]), "notes": set(e["notes"]),
                             "piece": i, "review": False, "reason": ""})
    # 종류 미표기('정기시험', '지필평가')는 같은 학교·학기·학년 안의 순서로 추정
    by_unit = OrderedDict()
    for ep in episodes:
        if ep["grade"] >= 1 and not ep["notes"]:
            by_unit.setdefault((ep["si"], ep["sem"], ep["grade"]), []).append(ep)
    for lst in by_unit.values():
        unk = sorted([e for e in lst if e["type"] == "UNK"], key=lambda e: e["start"])
        if not unk:
            continue
        known = [e for e in lst if e["type"] != "UNK"]
        kt = {e["type"] for e in known}
        if len(unk) == 2 and not known:
            unk[0]["type"], unk[1]["type"] = "MID", "FINAL"
            for e in unk:
                e["rule"] = "종류 미표기 → 학기 내 순서로 추정(앞=중간, 뒤=기말)"
        elif len(unk) == 1 and kt == {"FINAL"} and unk[0]["end"] < min(e["start"] for e in known):
            unk[0]["type"], unk[0]["rule"] = "MID", "종류 미표기 → 같은 학기 기말보다 앞서 중간으로 추정"
        elif len(unk) == 1 and kt == {"MID"} and unk[0]["start"] > max(e["end"] for e in known):
            unk[0]["type"], unk[0]["rule"] = "FINAL", "종류 미표기 → 같은 학기 중간보다 뒤라 기말로 추정"
    for ep in episodes:
        why = []
        if ep["type"] == "UNK":
            why.append(ep["rule"].split(" / ")[0] or "시험 종류 불명")
            if ep["grade"] >= 1 and not ep["notes"]:
                why[-1] += " (같은 학기 다른 시험과 순서로도 판단 불가)"
        if ep["grade"] == 0:
            why.append("학년 정보 없음(학년별 행사 여부 전부 N)")
        if ep["notes"]:
            why.append(",".join(sorted(ep["notes"])))
        if ep["piece"] > 0 and "추정" not in ep["rule"]:
            why.append(f"같은 시험명이 {TH['GAP_SPLIT']}일 이상 떨어져 재등록")
        if why:
            ep["review"], ep["reason"] = True, " · ".join(why)
    ctx = OrderedDict()
    for ep in episodes:
        if ep["review"] or ep["type"] == "UNK" or ep["grade"] == 0:
            continue
        ctx.setdefault((ep["si"], ep["sem"], ep["grade"]), []).append(ep)
    for lst in ctx.values():
        mids = [e for e in lst if e["type"] == "MID"]
        fins = [e for e in lst if e["type"] == "FINAL"]
        if mids and fins and min(e["start"] for e in mids) > min(e["start"] for e in fins):
            for e in mids + fins:
                e["review"], e["reason"] = True, "중간 시작일이 기말보다 늦음(순서 불일치)"
        if mids and not fins:
            for e in mids:
                if "서수" not in e["rule"]:
                    continue
                d = dt.date.fromordinal(e["start"])
                late = (d.month > 6 or (d.month == 6 and d.day >= 15)) if e["sem"] == 1 else \
                    (d.month == 12 or (d.month == 11 and d.day >= 20) or d.month <= 2)
                if late:
                    e["review"], e["reason"] = True, '"1차" 지필이 학기말 시기에 단독 등록 — 기말일 가능성'
    episodes.sort(key=lambda e: (e["si"], e["sem"], TYPE_IDX[e["type"]], e["grade"], e["start"]))

    # ---------- 주요 일정·이벤트 ----------
    ms = [dict(disc=set()) for _ in schools]
    events = []
    vac = {}
    for r in clean:
        c, mo, m = r["k"]["cat"], (r["ymd"] // 100) % 100, ms[r["si"]]

        def setmin(k):
            if m.get(k) is None or r["ymd"] < m[k]:
                m[k] = r["ymd"]
        if c in ("OPENING", "ENTRANCE") and mo == 3: setmin("open1")
        if c == "ENTRANCE": setmin("entrance")
        if c == "VACATION" and mo in (7, 8): setmin("summer")
        if c == "OPENING" and mo in (8, 9): setmin("open2")
        if c == "VACATION" and mo in (12, 1, 2) and "봄방학" not in r["name"]: setmin("winter")
        if c == "GRAD": setmin("grad")
        if c == "CLOSING": setmin("closing")
        if c == "DIAG": setmin("diag")
        if c == "ACHIEVE": setmin("achieve")
        if c == "FORMATIVE": setmin("formative")
        if c == "DISCRETION": m["disc"].add(r["ymd"])
        if c == "VACATION":
            vac.setdefault(r["si"], []).append(r)
        elif c in EVENT_CATS:
            events.append([r["si"], c, r["ymd"], r["ymd"], r["g"], r["name"], r["sem"]])
    for si, lst in vac.items():   # 방학 일별 행 → 기간으로 압축 (주말·공휴일로 끊긴 4일 이하 간격은 이어 붙임)
        cur = None
        for r in lst:
            if cur and r["ord"] - cur["e"] <= 4:
                cur["e"], cur["g"] = r["ord"], cur["g"] | r["g"]
            else:
                if cur: events.append([si, "VACATION", ord_to_ymd(cur["s"]), ord_to_ymd(cur["e"]), cur["g"], cur["n"], cur["sem"]])
                cur = {"s": r["ord"], "e": r["ord"], "g": r["g"], "n": r["name"], "sem": r["sem"]}
        if cur: events.append([si, "VACATION", ord_to_ymd(cur["s"]), ord_to_ymd(cur["e"]), cur["g"], cur["n"], cur["sem"]])
    events.sort(key=lambda e: (e[0], e[2], e[1], e[5]))

    # ---------- 직렬화 ----------
    names, rules, reasons = Interner(), Interner(), Interner()
    ep_rows = [[e["si"], e["grade"], e["sem"], TYPE_IDX[e["type"]], ord_to_ymd(e["start"]), ord_to_ymd(e["end"]), e["days"],
                [d - e["start"] for d in e["dates"]], [names(n) for n in e["names"]], rules(e["rule"]),
                reasons(e["reason"]) if e["review"] else -1] for e in episodes]
    ev_names = Interner()
    ev_rows = [[si, EVENT_CATS.index(c), a, b, g, ev_names(n), sem] for si, c, a, b, g, n, sem in events]
    ms_rows = [[i, *[m.get(k) for k in MS_KEYS], sorted(m["disc"])] for i, m in enumerate(ms)]
    files = {
        "schools.json": {"cols": ["code", "name", "region", "level", "hsType", "homepage", "loadDtm", "schedLoadDtm", "inSchoolInfo"],
                         "rows": [[s["code"], s["name"], s["region"], s["level"], s["hs"], s["homepage"], s["load"], s.get("schedLoad", ""), s["inInfo"]] for s in schools]},
        "episodes.json": {"cols": ["school", "grade", "sem", "type", "start", "end", "days", "dateOffsets", "nameIds", "ruleId", "reasonId"],
                          "types": ["MID", "FINAL", "UNK"], "names": names.list, "rules": rules.list, "reasons": reasons.list, "rows": ep_rows},
        "events.json": {"cols": ["school", "cat", "start", "end", "gradeMask", "nameId", "sem"], "cats": EVENT_CATS, "names": ev_names.list, "rows": ev_rows},
        "milestones.json": {"keys": MS_KEYS, "rows": ms_rows},
    }
    # 학교 상세용 원자료 (지역_학교급). 방학 일별 행·공휴일 행은 events.json의 기간으로 대신합니다.
    raw = {}
    for r in clean:
        if r["k"]["cat"] in ("VACATION", "HOLIDAY"):
            continue
        s = schools[r["si"]]
        f = raw.setdefault(f"raw/{s['region']}_{s['level']}.json", {"names": Interner(), "rules": Interner(), "rows": []})
        k = r["k"]
        f["rows"].append([r["si"], r["ymd"], f["names"](r["name"]), f["names"](r["content"]), r["g"], r["h"],
                          RAW_CATS.index(k["cat"]), TYPE_IDX[k["type"]] if k["type"] else -1, r["sem"], f["rules"](k["rule"] + (" · " + r["note"] if r["note"] else ""))])
    for p, f in raw.items():
        files[p] = {"cols": ["school", "ymd", "nameId", "contentId", "gradeMask", "holiday", "cat", "type", "sem", "ruleId"],
                    "cats": RAW_CATS, "types": ["MID", "FINAL"], "names": f["names"].list, "rules": f["rules"].list, "rows": f["rows"]}

    # ---------- 검증용 통계 ----------
    eps_by = {}
    for e in episodes:
        eps_by.setdefault(e["si"], []).append(e)
    by_rl = {}
    for i, s in enumerate(schools):
        for rg in ("ALL", s["region"]):
            by_rl.setdefault((rg, s["level"]), []).append(i)
    exam_stats, ms_stats = [], []
    for rg in ["ALL"] + [c for c, _ in config.OFFICES]:
        for lv in "EMH":
            ss = by_rl.get((rg, lv), [])
            for g in ["ALL"] + (["G12"] if lv in "MH" else []) + list(range(1, config.MAXG[lv] + 1)):
                for sem in (1, 2):
                    for typ in ("MID", "FINAL"):
                        starts, ends, days = [], [], []
                        for si in ss:
                            cand = [e for e in eps_by.get(si, []) if e["sem"] == sem and e["type"] == typ and not e["review"]
                                    and (e["grade"] >= 1 if g == "ALL" else e["grade"] in (1, 2) if g == "G12" else e["grade"] == g)]
                            if not cand:
                                continue
                            first = cand[0]
                            for e in cand:
                                if e["start"] < first["start"]:
                                    first = e
                            starts.append(first["start"]); ends.append(max(e["end"] for e in cand)); days.append(first["days"])
                        st = summarize(starts)
                        n, den = len(starts), len(ss)
                        rate = n / den if den else None
                        row = [rg, lv, g, sem, typ, n, den]
                        if st:
                            row += [ord_to_ymd(st[k]) for k in ("min", "q1", "med", "q3", "max")] + [ord_to_ymd(max(ends)), round(sum(days) / n, 4)]
                        else:
                            row += [None] * 7
                        row.append(status_of(n, rate, TH, den))
                        exam_stats.append(row)
            for k in MS_KEYS:
                vals = [ymd_to_ord(ms[si][k]) for si in ss if ms[si].get(k) is not None]
                st = summarize(vals)
                ms_stats.append([rg, lv, k, len(vals), len(ss)] + ([ord_to_ymd(st[x]) for x in ("min", "q1", "med", "q3", "max")] if st else [None] * 5))
    files["stats.json"] = {"examCols": ["region", "level", "grade", "sem", "type", "n", "den", "min", "q1", "med", "q3", "max", "lastEnd", "avgDays", "status"],
                           "exam": exam_stats, "milestoneCols": ["region", "level", "key", "n", "den", "min", "q1", "med", "q3", "max"], "milestone": ms_stats}

    # ---------- 요약 ----------
    with_rows = {r["si"] for r in clean}
    with_exam = {e["si"] for e in episodes if not e["review"]}
    by_level = {}
    for lv in "EMH":
        ids = [i for i, s in enumerate(schools) if s["level"] == lv]
        by_level[lv] = {"schools": len(ids), "withSchedule": sum(1 for i in ids if i in with_rows), "withExam": sum(1 for i in ids if i in with_exam)}
    summary = {"schools": len(schools), "schoolsWithSchedule": len(with_rows),
               "coverage": round(len(with_rows) / len(schools), 4) if schools else 0,
               "rows": len(clean), "episodes": len(episodes), "reviewEpisodes": sum(1 for e in episodes if e["review"]),
               "byLevel": by_level, "notInSchoolInfo": sum(1 for s in schools if not s["inInfo"])}
    summary["status"] = "ok" if summary["coverage"] >= TH["YEAR_COVERAGE"] else "insufficient"
    return files, summary


def write_files(out_dir, files):
    out = Path(out_dir)
    for name, obj in files.items():
        p = out / name
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        tmp.replace(p)
