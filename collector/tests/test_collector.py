"""단위 시험: python -m unittest discover -s collector/tests -t ."""
import unittest

from collector.classify import classify_name, sem_of_date
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
