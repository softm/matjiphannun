# 맛집한눈 데이터 파이프라인 — 향후 운영 구조

현재 구현과 **미구현 계획**을 혼동하지 말 것.

## 현 상태

- 클라이언트 사용자가 명시적 인근 검색할 때 OSM Overpass API 조회 → localStorage 6시간 캐시 (한 곳 캐시)
- 사용자 명시적 지역검색 또는 허용한 현위치 주소 조회 시 Nominatim 호출
- 정적 Github Pages 페이지; 전국 식당 DB·수집 자동화·중복 제거 전체 파이프라인은 아직 없음
- 서버 측 SNS 크롤링, 리뷰 수집, 가격 산출은 하지 않음

## 운영 전환 예정

### 1. 정규화 스키마

```json
{
  "restaurantId": "source:license-no-or-id",
  "displayName": "예시 이름",
  "businessStatus": {"code": "OPEN", "source": "official-license", "checkedAt": "ISO8601"},
  "location": {"lat": 0, "lon": 0, "roadAddress": "...", "geoConfidence": "verified"},
  "cuisine": ["korean"],
  "menu": [{"name": "메뉴명", "priceKrw": 0, "verifiedAt": "ISO8601", "evidence": "merchant-confirmed"}],
  "hygieneGrade": {"value": null, "source": "official", "checkedAt": null},
  "reviewEvidence": {"userVerifiedCount": null, "provider": null},
  "hours": {"raw": null, "verifiedAt": null},
  "provenance": [{"provider": "official-license", "license": "check-provider-terms", "retrievedAt": "ISO8601"}]
}
```

이 스키마는 **예시**이며 `OPEN`, `priceKrw=0` 등은 실제 데이터가 아닙니다.

### 2. 식당 정합/중복 제거

- 행정안전부·식품안전나라 인허가 번호 같은 공적 식별자를 우선 키로 사용.
- 외부 업체명이 조금 다른 경우 주소 정규화 + 50m 근접 + 전화번호로 후보 연결, **자동 확정 금지**. 미확정 항목에는 출처별 명칭 보존.
- 폐업·영업중 상태는 취득 기준일 표시. 확인되지 않은 상태는 UNKNOWN.
- 사진·리뷰·가격은 제공사 계약/저작권/개인정보 동의 확인 후 사용.

### 3. 배치/상태 표기

- 공식 업데이트 주기 및 이용조건을 확인한 후 `GitHub Actions`로 1일 1회 또는 제공사 권장 주기로 갱신.
- 원본 파일은 라이선스가 허용하는 경우에만 저장소에 넣고, 운영 앱에서 필요한 필드만 샤딩된 정적 JSON으로 공개.
- `data-status.html`: 전국 원천별 원본건수/정상건수/폐업제외건수/좌표수/최종성공일/처리오류건수/무효주소/추적가능한 출처 표시.
- 원천 요청 실패 시 마지막 정상 데이터 유지 + 데이터 기준일 경고.
- 메뉴 가격이 검증되지 않으면 가성비 TOP5 랭킹 계산하지 않음.

### 4. 배포/비용

- 조회량이 많아지면 공개 Overpass 및 Nominatim 직접 조회 제거. 지역별 JSON을 빌드·CDN에 배포하고 지도 타일 서비스는 라이선스/트래픽 정책에 맞게 계약.
- 실시간 예약 또는 위치 계산 API는 필요한 경우에만 서버리스 프록시를 사용하고 GitHub Pages와 역할을 분리.
- 광고는 이용자 검색 상단을 가리지 않는 접힘형 슬롯에만 배치. 협찬 검색 결과는 '광고' 표기.
