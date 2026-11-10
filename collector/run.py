"""수집 실행 진입점.

  python -m collector.run                      # 현재·다음 학년도 (처음이면 직전 학년도도 함께)
  python -m collector.run --years 2025,2026    # 학년도 지정
  python -m collector.run --offices B10,J10    # 일부 교육청만 (검증용)
  python -m collector.run --mode school        # 학교별 조회 강제

결과: docs/data/manifest.json, docs/data/{학년도}/*.json
실패 정책: 일일 한도 초과로 중단되거나 실패 학교 비율이 기준을 넘으면 그 학년도 파일은 덮어쓰지 않습니다.
"""
import argparse
import datetime as dt
import json
import shutil
import sys
import time
from pathlib import Path

from . import config
from .build_data import build_year, write_files
from .collect import Checkpoint, collect_schedule, collect_schools
from .neis_client import AuthError, DailyLimitError, NeisClient

KST = dt.timezone(dt.timedelta(hours=9))


def now_iso():
    return dt.datetime.now(KST).isoformat(timespec="seconds")


def current_ay(today=None):
    t = today or dt.datetime.now(KST).date()
    return t.year if t.month >= 3 else t.year - 1


def main(argv=None):
    ap = argparse.ArgumentParser(description="NEIS 학사일정 수집기")
    ap.add_argument("--years", default="auto")
    ap.add_argument("--offices", default="all", help="예: B10,J10")
    ap.add_argument("--mode", default="auto", choices=["auto", "bulk", "school"])
    ap.add_argument("--out", default="docs/data")
    ap.add_argument("--cache", default="cache")
    ap.add_argument("--max-age-hours", type=float, default=None)
    ap.add_argument("--source-label", default=None, help="manifest의 source 값 (기본: NEIS, 모의 서버면 MOCK)")
    ap.add_argument("--workers", type=int, default=None, help="학교별 조회 동시 실행 수 (기본 6)")
    args = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(line_buffering=True)   # GitHub Actions 로그에 진행 상황이 바로 보이도록
    except AttributeError:
        pass

    if not config.API_KEY:
        print("NEIS_API_KEY 환경변수가 없습니다. README의 '인증키 넣기'를 따라 설정하세요.", file=sys.stderr)
        return 2
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    man_path = out / "manifest.json"
    manifest = json.loads(man_path.read_text(encoding="utf-8")) if man_path.exists() else {"schema": 1, "yearInfo": {}, "runs": []}
    cur = current_ay()
    if args.years == "auto":
        years = [cur, cur + 1]
        if not (out / str(cur - 1) / "episodes.json").exists():
            years.insert(0, cur - 1)       # 첫 실행: 전년 대비용 직전 학년도도 수집 (이후에는 보관만)
    else:
        years = [int(y) for y in args.years.split(",")]
    offices = config.OFFICES if args.offices == "all" else [o for o in config.OFFICES if o[0] in args.offices.split(",")]
    source = args.source_label or ("NEIS" if "open.neis.go.kr" in config.BASE_URL else "MOCK")

    run = {"startedAt": now_iso(), "years": years, "offices": [o[0] for o in offices], "status": "running", "yearResults": {}}
    client = NeisClient()
    ck = Checkpoint(args.cache, args.max_age_hours)
    t0 = time.time()
    try:
        print(f"[1/3] 학교기본정보 수집 ({len(offices)}개 교육청)")
        schools = collect_schools(client, ck, offices)
        print(f"  초·중·고 {len(schools):,}곳")
        for ay in years:
            print(f"[2/3] {ay}학년도 학사일정 수집")
            rows, rep = collect_schedule(client, ck, ay, schools, offices, args.mode, workers=args.workers, probe=ay > cur)
            args.mode = rep["mode"]   # 다음 학년도부터는 판정 생략
            failed = rep["failed_schools"]
            print(f"[3/3] {ay}학년도 집계 ({len(rows):,}행, 실패 학교 {len(failed)}곳)")
            files, summary = build_year(ay, schools, rows, failed)
            ratio = len(failed) / max(1, len(schools))
            yr = {"mode": rep["mode"], "rows": len(rows), "failedSchools": len(failed), "failedSchoolCodes": failed[:200],
                  "fallbackChunks": rep["fallback_chunks"], "probe": rep.get("probe"), **summary}
            if rep.get("skipped"):
                summary["message"] = yr["message"] = "표본 학교 조회 결과 아직 등록된 일정이 없어 전체 조회를 건너뛰었습니다"
            if ratio > config.MAX_FAILED_SCHOOL_RATIO and (out / str(ay)).exists():
                yr["status"] = "kept_previous"
                yr["message"] = f"실패 학교 비율 {ratio:.1%} > 기준 {config.MAX_FAILED_SCHOOL_RATIO:.0%} — 이전 데이터를 유지했습니다"
                print("  " + yr["message"])
            else:
                tmp = out / f"{ay}.tmp"
                shutil.rmtree(tmp, ignore_errors=True)
                write_files(tmp, files)
                dst = out / str(ay)
                old = out / f"{ay}.old"
                shutil.rmtree(old, ignore_errors=True)
                if dst.exists():
                    dst.rename(old)
                tmp.rename(dst)
                shutil.rmtree(old, ignore_errors=True)
                yr["collectedAt"] = now_iso()
                manifest["yearInfo"][str(ay)] = {**manifest["yearInfo"].get(str(ay), {}), **yr}
            run["yearResults"][str(ay)] = {k: yr.get(k) for k in ("status", "rows", "schools", "coverage", "failedSchools", "mode", "message")}
            if yr.get("status") == "kept_previous":
                manifest["yearInfo"].setdefault(str(ay), {})["lastAttempt"] = {"at": now_iso(), "message": yr["message"], "failedSchools": len(failed)}
        run["status"] = "success" if all(r.get("failedSchools", 0) == 0 for r in run["yearResults"].values()) else "partial"
    except DailyLimitError as e:
        run["status"] = "stopped_daily_limit"
        run["message"] = f"NEIS 일일 호출 한도에 도달해 중단했습니다({e.code}). 받은 조각은 저장되었고 다음 실행에서 이어 받습니다. 기존 데이터는 그대로입니다."
        print(run["message"])
    except AuthError as e:
        run["status"] = "failed"
        run["message"] = f"인증키 오류({e.code}: {e.message}). GitHub Secrets의 NEIS_API_KEY를 확인하세요."
        print(run["message"], file=sys.stderr)
    except Exception as e:  # 예기치 못한 오류: 기존 데이터 유지
        run["status"] = "failed"
        run["message"] = f"{type(e).__name__}: {e}"
        print("수집 실패:", run["message"], file=sys.stderr)
    run.update({"finishedAt": now_iso(), "seconds": round(time.time() - t0), "calls": client.calls, "retries": client.retried})
    manifest.update({"schema": 1, "source": source, "generatedAt": now_iso(), "currentAy": cur, "thresholds": config.THRESH,
                     "lastRun": run, "runs": ([run] + manifest.get("runs", []))[:20]})
    manifest["years"] = sorted(int(p.name) for p in out.iterdir() if p.is_dir() and p.name.isdigit() and (p / "episodes.json").exists())
    for y in list(manifest["yearInfo"]):
        if int(y) not in manifest["years"]:
            manifest["yearInfo"].pop(y)
    man_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"완료: {run['status']} · 호출 {client.calls:,}회 · 재시도 {client.retried}회 · {run['seconds']}초")
    return 1 if run["status"] == "failed" else 0


if __name__ == "__main__":
    sys.exit(main())
