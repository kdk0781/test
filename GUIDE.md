# 아파트 시세표 PWA — GUIDE.md

> `kdk0781.github.io/kb/map/` 기준  
> 마지막 업데이트: 2026-04-06 · v10.0

---

## 파일 구조

```
kb/map/
├── index.html          # 앱 HTML 진입점
├── manifest.json       # PWA 설치 설정
├── sw.js               # 서비스워커 (Cache-First + CSV no-store)
├── css/
│   └── common.css      # 전체 스타일 (라이트/다크 자동 대응)
├── js/
│   ├── app.js          # 난독화 빌드 (실제 서비스용)
│   └── app_src.js      # 소스 원본 (이 파일만 수정)
└── excel/
    └── map.csv         # KB 주간 아파트 시세 (매주 교체)
```

---

## 빌드 방법

`app_src.js` 수정 → Node.js 빌드 스크립트로 `app.js` 생성 → `index.html` `?v=` 숫자 +1

---

## 기능 목록

### 1. CSV 파싱

- 인코딩: EUC-KR (실패 시 UTF-8 폴백)
- 상태기계 파서 `parseCSVLine()` — 홀수 따옴표 안전
- `cache: no-store` + SW CSV bypass → 항상 최신 데이터
- 상위 15행에서 기준일 자동 추출

### 2. 화면 구성

- 스티키 헤더 (검색 · 지역칩 · 정렬 · 단위토글)
- 카드 목록 무한스크롤 (20개씩 IntersectionObserver)
- 아코디언: 면적별 하한가 / 일반가 / 상한가
- ㎡ ↔ 평 토글 (CSS class 전환, 재렌더링 없음)
- 맨위로 버튼 (300px 초과 시 우하단)

### 3. 가격 변동

두 슬롯: `apt_map_curr` / `apt_map_prev`

| 상황 | 동작 |
|------|------|
| 새 날짜 CSV | curr → prev 승격, 새 데이터 → curr |
| 같은 날짜 재로드 | curr · prev 유지, diff 계속 표시 |
| 강제 새로고침 | SW · 브라우저 캐시만 초기화, 가격 캐시 보존 |

🔺빨강(상승) / 🔽파랑(하락) / `-` 회색(변동없음)

### 4. 대출 한도

- 기준: 하한가(1층) / 일반가(일반층)
- LTV: 규제지역 40% / 기타 70%
- 정책: ≤15억→6억 / ≤25억→4억 / 초과→2억
- 최종 = min(LTV, 정책) — 100만원 단위 절사

### 5. 규제지역 (2025.10.16 기준)

| 등급 | 지역 | LTV |
|------|------|-----|
| zone-A 투기지역 | 강남·서초·송파·용산 | 40% |
| zone-B 투기과열 | 서울 나머지 + 경기 12곳 | 40% |
| 기타 | 전국 | 70% |

### 6. 즐겨찾기

- 카드 좌측 `☆/⭐` 별표 → `apt_map_favs` localStorage 영구 저장
- ⭐즐겨찾기 칩 → 즐겨찾기 단지만 필터링
- **모바일**: 별표만 표시, 텍스트 숨김
- **공유 수신자 즐겨찾기 허용 OFF**: 별표·칩 UI 자체가 숨겨짐

### 7. 최근 검색어

- 검색 실행 시 자동 저장 (최대 5개, `apt_map_recent`)
- 검색창 빌 때만 칩 표시
- 칩 클릭 → 즉시 필터 / `✕` 개별 삭제
- **새로고침해도 유지** (PWA 설치자 · 공유 수신자 공통)

---

## 임시 공유 링크 시스템

### 수정 가능 상수 (app_src.js 상단)

```js
// ① 암복호화 비밀키 (변경 시 기존 링크 전부 무효화)
const SHARE_SECRET = 'kdk_apt_2026_!@#';

// ② URL 파라미터명 (짧고 의미 없는 값)
const SHARE_PARAM  = 'k';

// ③ 만료 페이지 문구
const SHARE_EXPIRED_MSG = {
    icon:  '🔒',
    title: '링크가 만료되었습니다',
    desc:  '접속량이 많아 유효한 페이지가 아닙니다.',
    sub:   '담당자분께 링크를 다시 요청하세요.',
};

// ④ 카카오/문자 공유 메시지 템플릿
const SHARE_COPY_TEMPLATE = (url) =>
`[KB 아파트 시세표]
아래 링크를 클릭하면 주간 시세를 확인하실 수 있습니다.
유효 기간이 있는 임시 링크이며, 기간 만료 시 접속이 제한됩니다.
${url}`;  // ← ${url} 위치 수정 금지
```

### 토큰 구조

```json
{
  "exp": 1234567890123,    // 만료 Unix ms
  "includeFavs": false     // 수신자 즐겨찾기 기능 허용 여부
}
```

암호화: **XOR cipher + URL-safe Base64** → TinyURL 단축  
→ 주소창에서 원본 도메인/경로/파라미터 완전 은닉

### 공유 흐름 (A → B → C → ... → N)

```
PWA 오너 A
  → 모달 열기
  → 기간 설정 (분/시간/일)
  → 즐겨찾기 기능 허용 토글 설정 (기본: OFF)
  → [링크 생성] → TinyURL 단축 → 카카오/문자 공유

수신자 B (링크 클릭)
  → 토큰 복호화 → 만료 검증
  → 유효: URL 정리 + 앱 실행
  → 즐겨찾기 허용 OFF: 별표·칩 UI 숨김
  → 즐겨찾기 허용 ON: 별표·칩 표시, 자신의 즐겨찾기 사용 가능
  → 최근 검색어: 자신의 localStorage에서 로드 (새로고침 유지)
  → [공유] 버튼 클릭 → 원본 URL (동일 토큰) 메시지 복사

수신자 C (B가 공유한 링크)
  → 동일 토큰 → exp 불변 (A가 설정한 날짜에 동시 만료)
  → includeFavs 불변 (A가 설정한 기능 허용 여부 그대로)
  → 최근 검색어: 자신의 localStorage에서 로드
```

**핵심 불변 원칙**: 토큰이 변하지 않으므로  
A → B → C → ... → N 체인 전체가 **동일한 만료일**, **동일한 기능 설정**

### 즐겨찾기 허용 ON / OFF 비교

| 항목 | 허용 OFF (기본) | 허용 ON |
|------|---------------|---------|
| 별표 버튼 | **숨김** | 표시 |
| 즐겨찾기 칩 | **숨김** | 표시 |
| 즐겨찾기 데이터 | 없음 | 수신자 자신의 데이터 |
| 최근 검색어 | 자신의 localStorage | 자신의 localStorage |

> 오너의 즐겨찾기 데이터는 어떤 경우에도 공유되지 않습니다.

### 만료 처리 (6단계 방어)

| 단계 | 조건 | 처리 |
|------|------|------|
| 1 | `_shr_blocked` 플래그 | 즉시 만료 페이지 |
| 2 | URL 유효 토큰 | URL 정리(난독화) + SS 저장 → 앱 실행 |
| 3 | URL 만료 토큰 | **URL도 정리** + 플래그 설정 → 만료 페이지 |
| 4 | SS 토큰 만료 | 플래그 설정 → 만료 페이지 |
| 5 | 새로고침 (플래그 있음) | 즉시 만료 페이지 유지 |
| 6 | 토큰 없음 | 정상 앱 실행 |

> 만료된 토큰도 주소창에서 보이지 않게 `history.replaceState`로 즉시 정리

### PWA 설치 차단 (공유 수신자)

- `beforeinstallprompt` 캡처 단계 차단
- `sw.js` 등록 생략

---

## CSV 교체 방법

1. KB 시스템에서 최신 시세 CSV 다운로드
2. 파일명 `map.csv` 저장
3. `excel/map.csv` 교체 후 GitHub push
4. 앱에서 새로고침 버튼 클릭

공유 링크 수신자도 CSV 교체 즉시 최신 데이터 확인 가능 (no-store fetch)

---

## 서비스워커 전략

| 대상 | 전략 |
|------|------|
| HTML / CSS / JS | Cache-First |
| `map.csv` | Network-Only (no-store) |
| 외부 도메인 | 무시 |

캐시명: `apt-price-v9` — 변경 시 구버전 자동 삭제

---

## 모바일 대응 (≤768px)

| 항목 | 처리 |
|------|------|
| 지역 칩 | 전체·서울·경기·인천만 표시 |
| 즐겨찾기 칩 | 별표만, 텍스트 숨김 |
| 공유 버튼 | 아이콘만, 텍스트 숨김 |
| 가격 범위 배지 | 숨김 |
| 카드 내부 | 면적 상단, 가격 3컬럼 풀폭 |
| 대출 정보 | 수신자 중앙 정렬 |

---

## 다크모드

`prefers-color-scheme: dark` 자동 감지. 주요 CSS 변수:

```css
--bg-color, --card-bg, --border-color
--text-main, --text-muted
--primary-color, --primary-dark
--price-color, --hover-bg
```

---

## 공유 링크 상태 저장 구조

```
sessionStorage (탭 생존 동안)   localStorage (영구 백업)
  _shr_t    : 암호화 토큰         _shr_ls  : { t, u } JSON 백업
  _shr_u    : 원본 URL            _shr_exp : 만료 확정 플래그
  _shr_blocked : 만료 차단 플래그  apt_map_favs   : 즐겨찾기
                                   apt_map_recent : 최근 검색어
                                   apt_map_curr   : 가격 캐시(현재)
                                   apt_map_prev   : 가격 캐시(이전)
```

**새로고침(F5) 흐름**
- sessionStorage 유지 → 토큰 읽기 → 설정 복원 ✓

**하드리프레시(버튼 클릭) 흐름**
- localStorage 주요 키 보존 후 clear
- sessionStorage 공유 키만 보존 후 clear
- 즐겨찾기·최근검색·공유토큰 모두 유지 ✓

**만료 6단계 방어**
1. `_shr_exp` localStorage 플래그 확인 (hard refresh 후에도 유지)
2. `_shr_blocked` sessionStorage 플래그 확인
3. URL 토큰 읽기 / sessionStorage 복원 / localStorage 백업 복원
4. 복호화 + 만료 시각 검증
5. 만료 시: URL 난독화 + 이중 차단 플래그 설정 + 만료 페이지
6. 새로고침 후: 차단 플래그 재확인 → 만료 페이지 유지

---

## 상태 저장 키 전체 목록

| 키 | 저장소 | 용도 | hard refresh 후 |
|----|--------|------|----------------|
| `apt_map_curr` | localStorage | 가격 캐시 현재 | ✅ 유지 |
| `apt_map_prev` | localStorage | 가격 캐시 이전 | ✅ 유지 |
| `apt_map_favs` | localStorage | 즐겨찾기 목록 | ✅ 유지 |
| `apt_map_recent` | localStorage | 최근 검색어 | ✅ 유지 |
| `_shr_ls` | localStorage | 공유 토큰 백업 | ✅ 조건부 유지 |
| `_shr_exp` | localStorage | 만료 확정 플래그 | ✅ 유지 |
| `_shr_t` | sessionStorage | 공유 토큰 | ✅ 보존 |
| `_shr_u` | sessionStorage | 원본 공유 URL | ✅ 보존 |
| `_shr_blocked` | sessionStorage | 만료 차단 플래그 | ✅ 보존 |
| `_shr_sess_alive` | sessionStorage | 탭 생존 확인 | ✅ 보존 |
| `_shr_rc_cleared` | sessionStorage | 수신자 최근검색 초기화 완료 | ✅ 보존 |

### 최근 검색어 저장 시점

타이핑 중에는 저장하지 않고 아래 시점에만 저장:
- **Enter 키** 입력 시
- **검색창 포커스 아웃** (blur) 시
- 2글자 이상일 때만 저장 (1글자 단어 제외)

### 공유 링크 URL 난독화

- 유효한 토큰 접속 시: 주소창이 깨끗한 URL로 즉시 정리
- 만료된 토큰 접속 시: 마찬가지로 주소창 즉시 정리 + 만료 페이지
- 로컬호스트(localhost) 개발 환경에서는 `history.replaceState` 효과가 보이지 않을 수 있음
- **실제 github.io 배포 환경에서만 URL 난독화 정상 작동**
