# 맛집한눈 (matjiphannun)

> 맛집을 나열하지 않고, 오늘 내 상황에 맞는 한 끼를 추천한다.

**모바일 지도 집중모드 + 상황 적합도 설명 + 내 맛집 기록**을 결합한 로컬 퍼스트 PWA 시제품입니다.

## 지금 동작하는 기능

- 권한 동의 기반 초기 내 위치 탐색, 거절 시 기본 탐색 위치 표시 (현위치로 속이지 않음)
- 동네/주소 검색(명시적 버튼), 현재 탐색 위치 저장/선택/삭제
- 지도에서 위치 이동 후 '이 지역 다시 검색', 1/2.4/5km 반경 선택
- OpenStreetMap Overpass 주변 식당·카페·간편식 실제 POI 검색 (모의 맛집 데이터 없음)
- 검색·카테고리·혼밥/간편식/여유로운 식사/카페 상황·거리/맞춤 정렬
- 사용자 상황 **적합도**와 사용 근거 공개 (맛 평점이 아님)
- 목록과 지도 마커 선택 연동, 추천 TOP5 마커 구분, 모바일 드래그 핸들 (27/54/90% 높이)
- 카카오 지도/Google 지도 길찾기, 전화, 공유, OSM 출처 링크
- 기기 내부 즐겨찾기/본인만의 별점/방문 메모; JSON 내보내기/가져오기
- installable PWA manifest, 정적 자산 오프라인 캐시, GitHub Pages workflow

## 실행 / 테스트

```bash
npm test
python3 -m http.server 5173
# 또는 npm run serve
```

`http://localhost:5173` 접속. 지도와 주변 장소 데이터는 외부 네트워크가 필요합니다. 위치 권한은 localhost/HTTPS의 secure context에서만 정상 동작합니다.

추가: [`data-status.html`](./data-status.html)에서 현재 브라우저의 마지막 검색 데이터 및 운영 미연동 항목을 확인할 수 있습니다. 전국 수집 현황이 아님을 명시합니다.

## GitHub Pages

저장소명: `softm/matjiphannun` (예정). **현재 파일은 배포가 아니라 저장소에 올릴 수 있는 소스입니다.**

1. GitHub에서 공개 저장소 `matjiphannun` 생성 (main).
2. 본 디렉터리 내용을 저장소 루트에 푸시.
3. `Settings → Pages → Build and deployment → Source: GitHub Actions` 선택.
4. `.github/workflows/pages.yml` Actions 성공 확인.
5. 예상 주소: `https://softm.github.io/matjiphannun/` (생성/배포를 확인하기 전에는 서비스 링크가 아님).

## 데이터 원칙

- OSM 장소 원본 실시간 호출이 실패하거나 비어 있으면 '정보 없음/조회 불가' 표시. 가짜 음식점과 평점 생성 금지.
- 메뉴 가격/리뷰 수/위생등급/현재 영업 여부는 외부 공식 데이터·검증 전 **미표시**.
- `내 조건 적합도`: 직선거리, OSM 업종, 부가 태그 존재, 개인 평가로만 계산. **맛을 보장하는 점수가 아님**.
- 위치는 본 기기의 브라우저에서 권한 동의를 받은 경우만 활용하고, 개인 방문 기록은 localStorage에만 보관 (타기기 자동 백업 없음).
- 장소를 조회하기 위해 지도 중심 좌표가 Overpass API에, 직접 검색한 동네 문자열은 Nominatim에 전송됩니다. 전송하는 정보/개인정보 정책을 출시 전에 명시해야 합니다.

## 운영화 전에 해야 할 일

1. OSM 공개 서버는 시제품/소규모 개발용. 대규모 운영에서는 공공데이터의 정기 파일 수집 및 계약한 상업용 장소 데이터 API/셀프호스팅으로 이전.
2. 식품안전나라/지자체 업소 인허가·위생등급·폐업정보를 식당 식별자와 결합하는 별도 배치 구축.
3. 메뉴 가격·예약·리뷰는 각 데이터 제공사의 계약/허용 범위에 따라 연동. 카카오 로컬 API는 일반 장소 메타데이터만 제공하며 별점/리뷰/실시간 영업 상태는 공식 응답에 없음.
4. 영업시간은 현재 OSM 원시 `opening_hours` 값만 보여주며 '영업중' 판단하지 않음.
5. 공개 Nominatim 검색은 **사용자 명시적 검색만**, 자동완성 없음, 사용량 캐시, 클라이언트 단위 1.1초 대기. 운영에서 전체 사용자 1req/s 상한 보장이 안 되므로 프록시+별도 geocoder로 교체.
6. 사용자 생성 기록의 암호화 백업/계정 동기화는 미구현. 공개 저장소나 광고/분석 SDK에 로컬 개인 데이터 유출하지 않도록 유지.

## 공식 자료

- Kakao Local API https://developers.kakao.com/docs/ko/local/dev-guide
- FoodSafetyKorea OpenAPI https://www.foodsafetykorea.go.kr/apiMain.do
- Overpass API https://wiki.openstreetmap.org/wiki/Overpass_API
- Nominatim policy https://operations.osmfoundation.org/policies/nominatim/
- OpenStreetMap copyright https://www.openstreetmap.org/copyright
