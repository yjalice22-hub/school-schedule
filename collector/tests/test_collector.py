"""단위 시험: python -m unittest discover -s collector/tests -t ."""
import unittest

from collector.build_data import build_year
from collector.classify import classify_event, classify_name, grades_in_name, sem_of_date
from collector.neis_client import NeisClient, DailyLimitError, AuthError, MissingParamError
from collector.stats import summarize, ymd_to_ord, ord_to_ymd


class ClassifyTest(unittest.TestCase):
    def c(self, name, level="M"):
        k = classify_name(name, level)
        return k["cat"], k["type"]

    def test_explicit(self):
        self.assertEqual(self.c("1학기 중간고사"), ("EXAM", "MID"))
        self.assertEqual(self.c("2학기 기말평가(3일차)"), ("EXAM", "FINAL"))
        self.assertEqual(self.c("학기말고사"), ("EXAM", "FINAL"))

    def test_ordinal_is_estimate(self):
        k = classify_name("1차 지필평가", "M")
        self.assertEqual((k["cat"], k["type"], k["conf"]), ("EXAM", "MID", "medium"))
        self.assertEqual(self.c("제2회 지필고사"), ("EXAM", "FINAL"))
        self.assertEqual(self.c("2회고사"), ("EXAM", "FINAL"))
        self.assertEqual(self.c("3차 지필평가")[0], "EXAM_REVIEW")

    def test_real_neis_patterns(self):
        # 2026-11 서울·경기 실제 수집에서 확인된 표현
        self.assertEqual(self.c("정기시험1차"), ("EXAM", "MID"))
        self.assertEqual(self.c("정기시험(2차)"), ("EXAM", "FINAL"))
        self.assertEqual(self.c("지필평가 2차"), ("EXAM", "FINAL"))
        self.assertEqual(self.c("정기시험(중간)"), ("EXAM", "MID"))
        self.assertEqual(self.c("중간 정기시험"), ("EXAM", "MID"))
        self.assertEqual(self.c("2학기 2차 지필평가(3학년)"), ("EXAM", "FINAL"))
        self.assertEqual(self.c("전국연합평가", "H")[0], "MOCK")
        self.assertEqual(self.c("중간놀이")[0], "OTHER")
        self.assertEqual(classify_event("정기시험", "2차 정기시험", "M")["type"], "FINAL")

    def test_grades_in_name(self):
        self.assertEqual(grades_in_name("기말고사(3학년)", 3), 0b100)
        self.assertEqual(grades_in_name("정기시험(1,2학년)", 3), 0b011)
        self.assertEqual(grades_in_name("기말고사(1,2)", 3), 0b011)
        self.assertEqual(grades_in_name("2,3학년 지필평가", 3), 0b110)
        self.assertEqual(grades_in_name("정기시험", 3), 0)
        self.assertEqual(grades_in_name("2학기 정기시험", 3), 0)

    def test_review_and_exclusions(self):
        self.assertEqual(self.c("지필평가")[0], "EXAM_REVIEW")
        self.assertEqual(self.c("정기고사")[0], "EXAM_REVIEW")
        self.assertEqual(self.c("1차 지필평가 성적 확인")[0], "OTHER")
        self.assertEqual(self.c("결시생 재시험")[0], "OTHER")
        self.assertEqual(self.c("수행평가 주간")[0], "OTHER")
        self.assertEqual(self.c("3월 전국연합학력평가", "H")[0], "MOCK")
        self.assertEqual(self.c("대학수학능력시험(재량휴업)", "H")[0], "MOCK")

    def test_elementary(self):
        self.assertEqual(self.c("기초학력 진단평가", "E")[0], "DIAG")
        self.assertEqual(self.c("맞춤형 학업성취도 자율평가", "E")[0], "ACHIEVE")
        self.assertEqual(self.c("학기말 평가", "E")[0], "FORMATIVE")
        self.assertEqual(self.c("단원평가 주간", "E")[0], "FORMATIVE")
        self.assertEqual(self.c("기말고사", "E"), ("EXAM", "FINAL"))

    def test_calendar_events(self):
        self.assertEqual(self.c("여름방학식")[0], "VAC_START")
        self.assertEqual(self.c("겨울방학")[0], "VACATION")
        self.assertEqual(self.c("2학기 개학식")[0], "OPENING")
        self.assertEqual(self.c("학교장 재량휴업일")[0], "DISCRETION")
        self.assertEqual(self.c("졸업식")[0], "GRAD")
        self.assertEqual(self.c("입학식")[0], "ENTRANCE")

    def test_semester(self):
        self.assertEqual(classify_name("2학기 1차 지필평가", "M")["sem_name"], 2)
        self.assertEqual(sem_of_date(20260427), 1)
        self.assertEqual(sem_of_date(20260818), 2)
        self.assertEqual(sem_of_date(20270105), 2)


class BuildTest(unittest.TestCase):
    def rows(self, items):
        out = []
        for ymd, name, flags in items:
            r = {"ATPT_OFCDC_SC_CODE": "B10", "SD_SCHUL_CODE": "7000001", "SCHUL_NM": "시험중", "AY": "2026", "DGHT_CRSE_SC_NM": "주간",
                 "SCHUL_CRSE_SC_NM": "중학교", "SBTR_DD_SC_NM": "해당없음", "AA_YMD": ymd, "EVENT_NM": name, "EVENT_CNTNT": ""}
            for i, f in enumerate(["ONE_GRADE_EVENT_YN", "TW_GRADE_EVENT_YN", "THREE_GRADE_EVENT_YN", "FR_GRADE_EVENT_YN", "FIV_GRADE_EVENT_YN", "SIX_GRADE_EVENT_YN"]):
                r[f] = "Y" if i < 3 and flags[i] == "Y" else "*"
            out.append(r)
        return out

    def eps(self, items):
        info = [{"ATPT_OFCDC_SC_CODE": "B10", "SD_SCHUL_CODE": "7000001", "SCHUL_NM": "시험중", "SCHUL_KND_SC_NM": "중학교"}]
        files, _ = build_year(2026, info, self.rows(items))
        e = files["episodes.json"]
        return [(r[1], r[2], e["types"][r[3]], r[4], r[6], r[10] >= 0) for r in e["rows"]]

    def test_multi_row_exam_is_one_episode(self):
        got = self.eps([("20260427", "중간고사", "YYY"), ("20260428", "중간고사", "YYY"), ("20260429", "중간고사(3일차)", "YYY")])
        self.assertEqual(len(got), 3)                      # 학년 3개
        self.assertTrue(all(g[2] == "MID" and g[3] == 20260427 and g[4] == 3 and not g[5] for g in got))

    def test_unlabeled_exams_by_order(self):
        got = self.eps([("20261012", "정기시험", "YYY"), ("20261013", "정기시험", "YYY"), ("20261207", "정기시험", "YYY")])
        types = {(g[0], g[2]) for g in got if not g[5]}
        self.assertIn((1, "MID"), types)
        self.assertIn((1, "FINAL"), types)

    def test_single_unlabeled_stays_review(self):
        got = self.eps([("20261207", "정기시험", "YYY")])
        self.assertTrue(all(g[5] for g in got))

    def test_grade_from_name_overrides_flags(self):
        got = self.eps([("20261123", "기말고사(3학년)", "YYY"), ("20261207", "기말고사(1,2학년)", "YYY")])
        by_grade = {g[0]: g[3] for g in got}
        self.assertEqual(by_grade, {1: 20261207, 2: 20261207, 3: 20261123})


class StatsTest(unittest.TestCase):
    def test_quantile_type7(self):
        # numpy.quantile([1,1,2,3,4,5,6,9],[.25,.5,.75]) = 1.75, 3.5, 5.25 → 반올림 2, 4, 5
        s = summarize([3, 1, 4, 1, 5, 9, 2, 6])
        self.assertEqual((s["min"], s["q1"], s["med"], s["q3"], s["max"]), (1, 2, 4, 5, 9))

    def test_dates(self):
        self.assertEqual(ord_to_ymd(ymd_to_ord(20280229)), 20280229)
        self.assertEqual(ymd_to_ord(20260302) - ymd_to_ord(20260227), 3)


class ParseTest(unittest.TestCase):
    def test_ok(self):
        d = {"SchoolSchedule": [{"head": [{"list_total_count": 2}, {"RESULT": {"CODE": "INFO-000", "MESSAGE": "정상"}}]}, {"row": [{"a": 1}, {"a": 2}]}]}
        self.assertEqual(NeisClient._parse("SchoolSchedule", d), (2, [{"a": 1}, {"a": 2}]))

    def test_no_data(self):
        self.assertEqual(NeisClient._parse("SchoolSchedule", {"RESULT": {"CODE": "INFO-200", "MESSAGE": "없음"}}), (0, []))

    def test_errors(self):
        with self.assertRaises(DailyLimitError):
            NeisClient._parse("x", {"RESULT": {"CODE": "ERROR-337", "MESSAGE": ""}})
        with self.assertRaises(AuthError):
            NeisClient._parse("x", {"RESULT": {"CODE": "ERROR-290", "MESSAGE": ""}})
        with self.assertRaises(MissingParamError):
            NeisClient._parse("x", {"RESULT": {"CODE": "ERROR-300", "MESSAGE": ""}})


if __name__ == "__main__":
    unittest.main()
