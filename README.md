# 전국 학사일정 분석 대시보드

교육부 나이스(NEIS) 교육정보 개방 포털의 **학교기본정보**와 **학사일정** API로 전국 17개 시·도 초·중·고 학사일정을 자동으로 모아, 지역·학교급·학년별 시험·방학·개학 시기를 분석하는 웹 대시보드입니다.

```
GitHub Actions (매주 월 06:00 KST, 1~3월은 목요일에도 + 수동 실행)
  └ collector/ (Python, 표준 라이브러리만 사용)
       ├ 학교기본정보: 교육청 17곳 × 초·중·고 → 조사 대상 학교(분모)
       ├ 학사일정: 교육청 × 월 단위 일괄 조회 → 안 되면 학교별 조회로 자동 전환
       ├ 행사명 분류 → 학교·학년·학기·시험별 '시험 기간' → 통계
       └ docs/data/ 에 JSON 저장 후 커밋 (실패가 많으면 기존 데이터 유지)
GitHub Pages ── docs/index.html (대시보드)가 docs/data/ 를 읽어 표시
```

비용: 공개(Public) 저장소라면 GitHub Actions와 GitHub Pages 모두 무료로 쓸 수 있습니다. 비공개(Private) 저장소는 요금제에 따라 Actions 사용 시간과 Pages 사용 가능 여부가 다르니 GitHub 요금 안내를 확인하세요. 공개 저장소로 만들면 대시보드 주소를 아는 사람은 누구나 볼 수 있습니다(데이터 자체는 공개 공공데이터입니다). **인증키는 어느 경우에도 저장소에 올라가지 않습니다.**

---

## 1. 처음 설정하기 (약 15분)

### 1-1. 저장소 만들기
1. https://github.com 에 로그인 → 오른쪽 위 **+** → **New repository**
2. Repository name: 예) `school-schedule` · **Public** 선택 → **Create repository**
3. 새 저장소 화면의 **uploading an existing file** 링크를 눌러, 내려받은 압축 파일을 푼 폴더 안의 **모든 파일과 폴더**를 끌어다 놓고 **Commit changes**
   - Mac Finder에서는 `.github` 폴더가 숨겨져 있습니다. `Cmd + Shift + .` 을 눌러 보이게 한 뒤 함께 올리세요. 이 폴더가 없으면 자동 수집이 동작하지 않습니다.
   - 업로드 후 저장소에 `.github/workflows/collect.yml` 이 보이면 성공입니다.

### 1-2. 인증키 넣기 (GitHub Secrets)
1. 저장소 **Settings** → 왼쪽 **Secrets and variables** → **Actions** → **New repository secret**
2. Name: `NEIS_API_KEY` · Secret: 발급받은 NEIS 인증키 → **Add secret**

인증키는 암호화되어 보관되고, 수집 기록이나 로그에도 표시되지 않습니다. 코드나 파일에 직접 적지 마세요.

### 1-3. 자동 커밋 권한 켜기
**Settings** → **Actions** → **General** → 맨 아래 **Workflow permissions** → **Read and write permissions** 선택 → **Save**

### 1-4. 첫 수집 실행
1. 저장소 **Actions** 탭 → (처음이면 "I understand my workflows…" 버튼) → 왼쪽 **NEIS 학사일정 수집** → 오른쪽 **Run workflow**
2. 처음에는 범위를 좁혀 확인하는 것을 권합니다: `offices` 에 `B10,J10` (서울·경기) 입력 → **Run workflow**
3. 초록 체크가 뜨면 성공. 실행 화면 아래 **Summary**에 학년도별 학교 수·등록률·실패 학교 수가 나옵니다.
4. 문제없으면 다시 **Run workflow** 를 `offices = all` 로 실행해 전국을 수집합니다.

> 첫 전국 수집은 현재·다음 학년도와 비교용 직전 학년도까지 3개 학년도를 받습니다. 교육청 일괄 조회가 되면 수십 분, 학교별 조회로 전환되면 몇 시간 걸릴 수 있습니다. 중간에 멈춰도 받은 부분은 저장되므로 다시 **Run workflow** 하면 이어서 받습니다.

### 1-5. 대시보드 공개하기 (GitHub Pages)
**Settings** → **Pages** → Source: **Deploy from a branch** → Branch: `main` / 폴더: `/docs` → **Save**

1~2분 뒤 `https://<GitHub아이디>.github.io/<저장소이름>/` 에서 대시보드가 열립니다. 이후 수집이 끝날 때마다 자동으로 새 데이터가 반영됩니다.

---

## 2. 평소 사용

| 하고 싶은 일 | 방법 |
|---|---|
| 지금 바로 갱신 | Actions → NEIS 학사일정 수집 → Run workflow |
| 특정 학년도만 다시 받기 | Run workflow → `years` 에 `2026` |
| 갱신이 잘 됐는지 확인 | 대시보드 왼쪽 아래 상태 상자, 또는 '데이터·갱신·방법론' 화면의 수집 기록 |
| 실패 알림 받기 | 실행이 실패하면 GitHub가 저장소 주인에게 메일을 보냅니다 (GitHub 알림 설정 기준) |
| 통계 재현성 확인 | '데이터·갱신·방법론' → **검증 실행** (수집기 계산값과 화면 계산값 전체 비교) |

### 자동 갱신 일정과 새 학년도
- 매주 월요일 06:00, 1~3월에는 목요일 06:00에도 실행됩니다.
- 학년도는 3월~다음 해 2월입니다. 수집기는 실행 날짜로 **현재 학년도와 다음 학년도**를 자동 계산합니다. 그래서 1월부터 다음 학년도 일정 등록 여부를 매주 확인하고, 3월이 되면 새 학년도가 '현재'가 됩니다. 손댈 것이 없습니다.
- 지난 학년도 데이터(`docs/data/2025/` 등)는 지우지 않고 보관합니다. 대시보드에서 학년도를 골라 비교할 수 있습니다.
- 새 학년도 등록 학교가 30% 미만이면 대시보드는 통계 대신 '아직 등록된 데이터가 충분하지 않습니다'를 표시합니다. 이전 학년도 통계로 채우지 않습니다.

### 실패했을 때의 동작
| 상황 | 동작 |
|---|---|
| 네트워크·서버 오류 | 지수 간격으로 최대 5회 재시도 |
| 교육청·월 단위 조회 실패 | 그 구간만 학교별로 다시 조회, 그래도 실패한 학교를 '실패 학교'로 기록 |
| 실패 학교 비율 1% 초과 | 그 학년도 파일을 덮어쓰지 않고 이전 데이터를 유지, 대시보드에 안내 표시 |
| 일일 호출 한도 초과(ERROR-337) | 즉시 멈추고 받은 조각을 저장, 다음 실행에서 이어 받음. 기존 데이터 유지 |
| 인증키 오류(ERROR-290 등) | 실패로 기록하고 종료. Secrets의 인증키를 확인 |

---

## 3. 내 PC에서 실행하기 (선택)

Python 3.10 이상이 필요합니다 (https://www.python.org/downloads/). 추가 설치 패키지는 없습니다.

**Windows (PowerShell)**
```powershell
cd 압축을푼폴더
$env:NEIS_API_KEY="발급받은인증키"
python -m collector.run --offices B10,J10      # 서울·경기만 먼저
python -m collector.run                         # 전국
cd docs; python -m http.server 8000            # 브라우저에서 http://localhost:8000
```

**Mac (터미널)**
```bash
cd 압축을푼폴더
export NEIS_API_KEY="발급받은인증키"
python3 -m collector.run --offices B10,J10
python3 -m collector.run
cd docs && python3 -m http.server 8000
```

`docs/index.html` 을 더블클릭하면 브라우저 보안 정책 때문에 데이터를 읽지 못합니다. 꼭 위처럼 `http.server` 로 여세요.

실제 NEIS 없이 수집기를 시험해 보려면 모의 서버를 씁니다 (Node.js 필요):
```bash
node tools/mock/export_mock.js tools/mock/data
python3 tools/mock/server.py --port 8765 --fail-rate 0.03 &
NEIS_BASE_URL=http://127.0.0.1:8765/hub NEIS_API_KEY=mockkey python3 -m collector.run --out /tmp/mockdata
```

---

## 4. 데이터 정확도 검증 방법

실제 데이터로 처음 수집한 뒤, 아래 순서로 한 번 점검하세요. 이후에는 학기마다 1번이면 충분합니다.

1. **수집 범위**: '데이터·갱신·방법론' → 학년도별 수집 현황에서 학교급별 조사 학교 수가 교육통계(학교 수)와 크게 다르지 않은지 봅니다. 등록률이 유난히 낮은 학교급·지역은 해석에 주의합니다.
2. **재현성**: 같은 화면의 **검증 실행** → '일치'가 나와야 합니다. 불일치가 나오면 대시보드(`web/`)와 수집기(`collector/`) 계산 규칙이 어긋난 것입니다.
3. **표본 대조 (가장 중요)**: 서울·경기 중·고 10곳 정도를 골라 '학교별 상세'의 학년별 시험 기간을 NEIS 원문(화면의 NEIS 원본 행)과 학교 홈페이지 학사일정과 비교합니다. 확인할 것:
   - 여러 날짜로 등록된 시험이 하나의 기간으로 묶였는지 (학교 수 중복 없음)
   - 학년 구분이 원문의 학년별 표시(Y)와 같은지
   - 1차/2차 지필평가가 중간/기말로 맞게 추정됐는지
4. **분류 검토 목록**: '분류 검토 목록'에 같은 표현이 많이 쌓이면 `collector/classify.py` 규칙에 추가하고, `collector/tests/test_collector.py` 에 사례를 넣은 뒤 다시 수집합니다.
5. **결측·편향**: 지역별 비교에서 `*`(표본 20곳 미만)나 '데이터 부족' 지역은 결론에 쓰지 않습니다.

### 통계 계산 기준 (요약)
- 학교별로 시험 시작일을 먼저 하나로 정한 뒤 분포를 계산합니다. '전체 학년'은 학교마다 가장 이른 학년의 시작일입니다.
- 사분위수: 선형보간(numpy `quantile(method="linear")`, Excel `QUARTILE.INC`) 후 가장 가까운 날짜로 반올림.
- 시험 집중 기간 = 첫 시험일 25~75%. 전체 등록 기간 = 가장 이른 시작일 ~ 가장 늦은 종료일.
- 등록 5곳 미만 '데이터 부족', 20곳 미만 '표본 부족', 등록률 50% 미만 '등록률 낮음'.
- 야간과정 행, 특수학교·각종학교, 공휴일 행은 제외. 같은 학교·날짜·행사명·학년의 중복 행은 1개로 셉니다.

---

## 5. 파일 구조

```
.github/workflows/collect.yml   자동 실행 설정 (일정, 인증키 연결, 결과 커밋)
collector/
  config.py        교육청 코드, 호출 간격·재시도·임계값 (환경변수로 변경 가능)
  neis_client.py   NEIS API 호출: 페이지네이션, 재시도, 결과 코드 처리
  collect.py       학교목록·학사일정 수집, 조각 저장(중단 후 재개), 학교별 재조회
  classify.py      행사명 분류 규칙
  build_data.py    시험 기간 묶기, 주요 일정, 대시보드용 JSON, 검증 통계
  stats.py         사분위수 계산
  run.py           실행 진입점
  tests/           단위 시험
docs/
  index.html       대시보드 (GitHub Pages가 여는 파일)
  data/            수집 결과 (manifest.json, 학년도별 폴더)
web/               대시보드 원본 조각 — 고친 뒤 `python web/build.py docs` 로 index.html 다시 생성
tools/mock/        실제 NEIS 없이 시험하는 모의 서버
```

## 6. 문제 해결

| 증상 | 확인할 것 |
|---|---|
| Actions 탭에 워크플로가 없음 | `.github/workflows/collect.yml` 이 업로드됐는지 |
| 커밋 단계에서 `Permission denied` | 1-3의 Read and write permissions |
| `인증키 오류` | Secrets 이름이 정확히 `NEIS_API_KEY` 인지, 키 앞뒤 공백 |
| 대시보드에 '데이터 파일을 찾지 못했습니다' | 첫 수집이 성공했는지, Pages 폴더가 `/docs` 인지 |
| 정기 실행이 멈춤 | 공개 저장소에서 60일간 활동이 없으면 GitHub가 예약 실행을 끕니다. Actions 탭에서 다시 켜세요 |
| 수집이 6시간 제한에 걸림 | 다시 Run workflow 하면 받은 조각부터 이어 받습니다 |
