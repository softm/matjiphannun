# 맛집한눈 데이터 연동 설계 v0.2

2026-10-27 · 지도: 네이버 Maps · 수집기·공개 데이터 조회 구현. 발급·검증 현황은 API_ISSUANCE.md 참조

## 1. 공급자와 역할

| 공급자 | 역할 | 공개 가능한 결과 | 인증 위치 |
|---|---|---|---|
| 소상공인시장진흥공단 | 기본 식당·카페 목록 | 식당 ID·상호·업종·주소·좌표·원천 기준일 | 수집기 Secret |
| 공식 인허가 공개자료 | 행정상 영업·폐업 확인 | 최소 업소 식별·상태·확인일 | 원천에 따라 파일 또는 수집기 Secret |
| 식품안전나라 C004 | 식품안심업소(위생등급) | 지정등급·유효기간·취소여부·출처 | 수집기 Secret |
| TourAPI | 음식점 사진·소개·제공되는 상세정보 | 허용된 콘텐츠·출처·사진별 이용조건 | 수집기 Secret |
| 네이버 Maps | 지도 표시·주소 좌표변환 | 지도 SDK 표출, 허용 범위 내 위치 결과 | Web Client ID / 서버 Client Secret |

OSM Overpass·Nominatim 실시간 의존을 제거했다. 지도와 주소 검색은 네이버 Maps 공식 SDK, 식당 조회는 수집한 지역별 공개 JSON을 사용한다. 데이터가 없는 지역은 수집 범위를 안내한다.

## 2. 초기 수집과 갱신

1. 공식 업종코드 목록을 먼저 확인해 음식점·카페 분류를 확정한다. 코드 체계와 기준일을 데이터 버전에 포함한다.
2. 상가정보 공식 전국/지역 파일을 이용 가능한 경우 초기 적재에 사용한다. 대체로 API의 업종별 상가업소 페이지를 분할 수집하고 마지막 성공 페이지를 체크포인트로 남긴다. 다운로드·재배포 조건은 실제 선택 파일 기준으로 확인한다.
3. 검증된 현행 API는 `https://apis.data.go.kr/B553077/api/open/sdsc2` 하위의 `storeListInUpjong`, `storeListByDate`, `storeOne`, `storeListInRadius`, `storeListInDong`, 업종 분류 조회 등을 사용한다. 각 필수 파라미터는 승인 후 Swagger/활용가이드와 대조한다. 전국 적재를 수많은 겹치는 반경 검색으로 대체하지 않는다.
4. 날짜 기반 변경·삭제 자료를 확인하여 기존 상가업소번호에 반영한다. 일 1회 확인을 목표로 하며 원천에서 같은 자료가 반환되면 중복 발행하지 않는다. 전체 대조 주기는 파일 게시 주기와 쿼터를 기준으로 확정한다.
5. 인허가 자료와 C004를 별도 수집해 업소를 연결한다. 지정종료·취소·폐업 정보를 확인한다. SAMPLE 응답을 실제 최신 지정현황으로 적재하지 않는다.
6. TourAPI 승인 화면에서 확인한 기본 경로는 `https://apis.data.go.kr/B551011/KorService2`이다. `areaBasedList2`, `areaBasedSyncList2`, `locationBasedList2`, `searchKeyword2`, `detailCommon2`, `detailIntro2`, `detailInfo2`, `detailImage2`, `detailPetTour2`, `ldongCode2`, `lclsSystmCode2`의 11개 기능이 승인되었다. 현행 분류코드·음식점 목록·동기화 목록을 확인하고 변경된 콘텐츠의 소개·이미지 자료를 분산 조회한다. 필수 파라미터와 음식점 분류는 실제 호출 전에 공식 활용가이드와 대조한다.
7. 원천 별 건수·이상치·누락을 확인한 뒤 새 버전 샤드를 작성한다. 성공한 버전의 manifest를 마지막에 교체한다.

## 3. 정규화 모델

```json
{
  "id": "internal-stable-id",
  "sourceIds": {"sbiz": null, "license": null, "tour": null},
  "name": null,
  "category": {"code": null, "name": null, "version": null},
  "location": {"lat": null, "lon": null, "roadAddress": null, "unit": null, "confidence": null},
  "businessStatus": {"value": "UNKNOWN", "source": null, "asOf": null},
  "hours": {"raw": null, "source": null, "asOf": null, "verified": false},
  "menu": [],
  "hygiene": {"grade": null, "validFrom": null, "validUntil": null, "cancelledAt": null, "source": null},
  "images": [],
  "matches": [],
  "provenance": []
}
```

메뉴 항목은 이름·가격·통화·가격 조건·확인일·출처가 있을 때만 채운다. 미확인 가격은 `null`로 처리한다. 사진 항목은 URL·저작자·제공기관·원문 URL·이용허락 유형을 포함한다. 원천 식별자에 개인정보가 포함되는지 검사하며 대표자·사업자번호는 공개 모델에 넣지 않는다.

## 4. 매칭 규칙

- 같은 원천의 동일 ID와 확정된 공적 인허가번호를 우선 사용한다.
- 서로 다른 원천은 정규화한 상호·주소·층/호·전화·좌표로 후보를 만든다. 50m 이내라는 이유만으로 자동 합치지 않는다.
- 정확한 주소와 상호가 일치해도 동일 건물의 지점·푸드코트 입점업소인지 검증한다. 불일치는 `candidate`로 유지한다.
- 위생 배지·사진은 `confirmed` 매칭에만 부여한다. 매칭된 콘텐츠가 없어도 기본 식당 목록은 유지한다.
- 원천별 필드의 기준일을 보존하고 충돌은 덮어쓰기 대신 이력으로 남긴다. 최근 공식 폐업이 확인되면 일반 추천에서 제외한다.

## 5. 배포와 키 보관

| 파일/설정 | 내용 |
|---|---|
| `data/manifest.json` | 데이터 버전, 원천 기준일, 수집 시각, 샤드 URL·건수·해시 |
| `data/regions/*.json` | 지역별 식당 최소 필드와 필요한 콘텐츠 |
| `data/status.json` | 원천 응답·처리·좌표·사진·위생·매칭·오류 수 |
| GitHub Actions Secrets | `DATA_GO_KR_SERVICE_KEY`, `FOODSAFETY_API_KEY` |
| Web SDK 공개 설정 | `config.js`의 도메인 제한 Client ID. 주소 검색·역지오코딩도 공식 Geocoder 서브 모듈을 사용하므로 Secret을 클라이언트에 넣지 않음 |
| 프론트 공개 설정 | 네이버 Web SDK용 Client ID 및 데이터 manifest URL. 비밀키는 포함하지 않음 |

인증키가 URL에 포함되는 공공 API 요청은 전체 URL·예외 객체·raw 응답에 포함된 키를 로그에 남기지 않는다. 키 값은 문서·커밋·브라우저 스크린샷·APK에서 제외한다. 필요한 인증정보는 서비스 콘솔과 Secrets에서만 관리한다.

네이버 Web 허용 origin은 `https://softm.github.io`, Android의 실제 WebView origin인 `https://appassets.androidplatform.net`을 등록했다. 도메인 등록만으로 WebView SDK 호출 성공을 보장하지 않는다. 실기기 인증·리퍼러 동작을 검증하고 실패 시 운영 HTTPS 웹앱 로드 또는 네이티브 SDK 방식 중 확인된 경로를 택한다. 필요하면 Android origin에서 로컬 개인기록을 내보내 새 origin으로 옮기는 절차를 제공한다.

## 6. 쿼터·장애·재시도

- 네이버 맛집한눈 전용 앱 한도: Dynamic Map 일 5,000/월 100,000, Geocoding·Reverse Geocoding 각 일 1,000/월 10,000. 초과 사용은 허용하지 않음.
- 대표 계정 무료 이용량은 계정 전체 앱 합산 정책이므로 위 한도만으로 비용 0원을 보장하지 않는다. 다른 앱 사용량과 함께 확인한다. 한도 적용 시 수초간 초과 가능하다는 콘솔 안내도 고려한다.
- 공공 API 429/쿼터 초과 시 호출을 멈추고 다음 허용 시점에 체크포인트에서 재개한다. 시간초과·5xx는 지수 백오프로 제한된 횟수만 재시도한다.
- 2026-10-27 승인 화면 기준 상가정보는 승인된 18개 기능마다 일 10,000건, TourAPI는 승인된 11개 기능마다 일 1,000건으로 표시되었다. 두 개발계정의 이용기간은 2026-10-27~2028-10-27이다. 총 호출 예산은 기능별 제한과 제공기관 운영정책을 함께 확인해 정한다.
- `HTTP 200`이라도 인증 오류 XML·API 오류 코드·JSON 스키마 오류를 정상 데이터로 저장하지 않는다.
- 한 원천 실패로 다른 원천의 정상 데이터를 지우지 않는다. 마지막 성공본과 오류 원천·기준일을 표시한다.
- 공공 API 활용기간 만료, 서비스 변경 공지, 사진 이용조건은 운영 점검 대상이다.

## 7. 수용 테스트

| 검증 | 통과 조건 |
|---|---|
| 발급과 연동 분리 | 신청·승인·키 확보·실제 호출·화면 연결 5단계 상태를 구분 |
| API 인증 | 각 원천 실제 소량 호출 성공과 필수 필드 확인, 키 로그 없음 |
| 페이지 수집 | 페이지 중단/재개, 중복 ID, 종료 조건, 변경/삭제 처리 검증 |
| 매칭 | 동명 식당·같은 건물 다른 식당·지점 이전을 오결합하지 않음 |
| 위생 | 만료·취소된 지정 정보는 현재 배지에서 제외 |
| 사진 | 원문·권리자·유형 표시, 다른 식당 사진 오연결 없음 |
| 장애 | 원천 실패 후 이전 manifest와 목록 유지, 미확인을 0건으로 오인하지 않음 |
| 지도 | 운영 도메인과 Android에서 마커·라벨·시트 크기 조절·현위치·주소 표시 검증 |

수집기 `scripts/collect_data.py`, 네이버 지도 `lib/naver-map.js`, 정적 데이터 조회 `lib/providers.js`를 구현했다. 공개 JSON은 지역별 gzip 압축을 Base64로 감싼 JSON이며 브라우저에서 `DecompressionStream`으로 읽는다. 실제 정규화 건수·수집 범위는 `data/status.json`을 따른다. 자동 갱신용 Secrets·활성화 변수와 Android 실기기 검증은 별도 상태로 관리한다.


## 공개 웹 세부정보·포인트 수집

- 실행: `python3 scripts/enrich_web.py --limit 1800 --seconds 2700 --workers 3 --interval 0.8`.
- 원천: 관광공사 `restaurants_sitemap.xml`, 공개 상세 화면/인쇄 화면이 사용하는 `TOUR_CONTENT_BODY_VIEW` 읽기 요청, 해당 원천에 연결된 업소 웹사이트의 Restaurant JSON-LD.
- robots 규칙을 확인하고, 원천 오류 시 대량 요청을 중지한다. 소스 변경·HTTP 오류·재시도·불일치는 체크포인트에 남긴다. 업소 링크는 사설 IP·사용자정보·비 HTTP URL을 배제하고 리디렉션도 검사한다.
- 매칭: 관광 콘텐츠 ID, 정규화한 전체 상호·주소, 좌표 오차를 모두 검사한다. 다른 층·지점·상호는 보류한다.
- 공개: `data/enrichment/regions/`의 주변 지역 보강 자료를 기본 목록에 합친다. 기존 전체 목록을 배치마다 다시 쓰지 않는다. 정보마다 출처·원천 수정일·확인일을 보관한다.
- 분석: 대표 메뉴, 준비/휴식시간, 마지막 주문, 주차 불가·유료·제한, 예약 조건, 가족·접근성 정보를 포인트로 정리한다. 상반된 원천은 하나로 단정하지 않는다. 미확인을 부정으로 바꾸지 않는다.
- 이미지: 개별 Type1·Type3 이용조건이 확인된 원본만 앱에서 표시한다. 갤러리 발견 수와 앱 재사용 가능 수를 구분한다. 사용자가 올린 사진·리뷰·프로필·관광공사 내부 담당자 연락처는 공개 데이터에 포함하지 않는다.
- 진행: `data/enrichment/status.json`은 대상·처리·남은 수·불일치·재시도·필드별 확보율을 표시한다. `.collection/web-state.json`은 공개 URL 식별자와 진행 상태만 Git에 저장하며 정적 배포에는 포함하지 않는다.
- 자동화: `.github/workflows/enrich-web.yml`은 코드 변경·수동 실행·매시간 40분에 실행한다. API 키 없이 공개 웹부터 수집하고, 기존 API 일괄 수집 워크플로와 공통 concurrency 그룹을 사용한다.
