# 맛집한눈 (matjiphannun)

[맛집한눈 웹](https://softm.github.io/matjiphannun/) · [데이터 현황](https://softm.github.io/matjiphannun/data-status.html) · [기획서](PRODUCT_SPEC.md) · [연동 설계](DATA_PIPELINE.md)

네이버 지도 위에 공식 식당 정보를 연결한 로컬 기록 중심 웹·Android 앱입니다.

## 구현 기능

- 네이버 Maps 지도·추천 TOP5 마커·이름 라벨·선택 연동
- 네이버 공식 Geocoder 서브 모듈을 이용한 주소 검색·현위치 주소 표시
- 소상공인시장진흥공단 상가정보와 한국관광공사 관광 음식점 목록
- 위치·음식 종류·거리·개인 기록 기반의 상황 적합도. 맛 평점을 생성하지 않음
- 공공누리 1·3유형이 확인된 실제 음식점 사진과 출처. 사진은 자르거나 가공하지 않음
- 유효기간·취소·폐업·상호/주소 매칭을 확인한 C004 공식 위생정보
- 목록·상세 시트 크기 조절, 모바일 마커 선택 시 지도 집중모드
- 네이버 지도/길찾기 연결, 전화·공유·위치 저장/삭제
- 기기 내부 즐겨찾기·개인 평가·메모, JSON 백업·복원
- 지역별 압축 JSON을 필요한 범위만 내려받음. 원천 기준일과 수집일 구분

전국의 모든 실제 영업 업소를 실시간으로 확인한 자료는 아닙니다. 수집 범위·원천 건수·사진·위생 연결 건수는 `data/status.json`에 기록합니다. 관광공사 목록은 관광정보에 등록된 음식점입니다. 행정상 영업·폐업 전체 인허가 대조, 현재 영업 여부, 메뉴 가격·방문자 리뷰는 미연동입니다.

## 개발·검증

```bash
npm test
python3 -m unittest discover -s tests -p 'test_*.py'
python3 scripts/build_static.py
```

네이버 지도는 등록한 운영 origin과 Android WebView origin에서 사용합니다. `config.js`에는 공개 Web SDK 식별자만 들어 있습니다. Client Secret·공공 API 키는 앱·APK에 넣지 않습니다.

## 데이터 갱신

```bash
# 수집기 전용 환경변수. 값은 출력하거나 커밋하지 않습니다.
export DATA_GO_KR_SERVICE_KEY='발급받은 원본 키'
export FOODSAFETY_API_KEY='발급받은 키'
python3 scripts/collect_data.py --cache /private/restaurant-collection --output data
```

실패·인증 오류·불완전한 페이지 수집은 기존 manifest를 교체하지 않습니다. C004는 동일 키 동시 호출을 거부하므로 순차 조회하며 INFO-500을 재시도합니다. `--cache`는 공개 정적 배포 영역 밖으로 지정합니다.

초기 공식 CSV ZIP과 검증된 관광 목록을 정규화할 때는 다음 경로를 지원합니다.

```bash
python3 scripts/collect_data.py --from-cache /private/verified-responses \
  --sbiz-zip /private/official-sbiz.zip --sbiz-date 2026-06-30 --output data
```

`.github/workflows/collect-data.yml`은 수집·검증·공개 데이터 커밋·Pages 배포를 수행합니다. `DATA_GO_KR_SERVICE_KEY`, `FOODSAFETY_API_KEY` Secrets와 `RESTAURANT_DATA_REFRESH_ENABLED=true` 변수가 있어야 실행됩니다. 준비한 시각은 매일 **03:15 KST**이며, Secrets를 등록하기 전에는 활성화하지 않습니다.

## Android

[비공개 Android 저장소](https://github.com/softm/matjiphannun.android)의 WebView는 동일한 웹 UI를 사용합니다. 지도 origin은 `https://appassets.androidplatform.net`이며, 식당 JSON은 GitHub Pages 공통 배포본을 읽습니다. 대용량 전국 데이터를 APK마다 중복 포함하지 않습니다. 기기 위치 권한과 실제 WebView 지도 인증은 실기기 확인 항목입니다.

## 공식 출처

- [소상공인시장진흥공단 API](https://www.data.go.kr/data/15012005/openapi.do)
- [소상공인시장진흥공단 공식 CSV 파일](https://www.data.go.kr/data/15083033/fileData.do)
- [한국관광공사 TourAPI](https://www.data.go.kr/data/15101578/openapi.do)
- [식품안전나라 C004](https://www.foodsafetykorea.go.kr/api/openApiInfo.do?svc_no=C004&menu_grp=MENU_GRP31&menu_no=661)
- [네이버 지도 Geocoder](https://navermaps.github.io/maps.js.ncp/docs/tutorial-Geocoder-Geocoding.html)


## 웹 세부정보와 방문 포인트

`enrich-web.yml`은 공개 관광 음식점 사이트맵과 연결된 업소 웹사이트를 이어 수집합니다. API 키가 필요 없는 웹 수집은 기존 기본 목록 API 갱신과 별도로 실행됩니다. 확인한 사실마다 출처·원천 수정일·확인일을 붙이고, 메뉴·휴식시간·마지막 주문·주차·예약·가족·접근성 정보를 방문 포인트로 표시합니다. 처리·미확보·불일치 수는 [데이터 현황](https://softm.github.io/matjiphannun/data-status.html)에 공개합니다.

웹에 있는 모든 사진의 재사용 권한이 자동으로 생기지는 않습니다. 사진별 이용조건을 확인한 이미지만 앱에 표시하고, 나머지는 사진 식별자·설명·원문 갤러리로 연결합니다. 전체 85만 업소의 세부정보가 모두 확보된 상태를 의미하지 않습니다.
