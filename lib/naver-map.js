import { NAVER_MAPS_CLIENT_ID } from '../config.js?v=20261027b';
let sdk;
export function loadNaverMaps() {
  if (window.naver?.maps?.Service) return Promise.resolve(window.naver.maps);
  if (sdk) return sdk;
  sdk = new Promise((resolve, reject) => {
    const fail = () => reject(new Error('네이버 지도를 불러오지 못했습니다. 네트워크와 지도 이용 한도를 확인해 주세요.'));
    const timer = setTimeout(fail, 15000);
    window.navermap_authFailure = () => { clearTimeout(timer); reject(new Error('네이버 지도 인증에 실패했습니다. 등록된 서비스 주소를 확인해 주세요.')); };
    window.matjipMapReady = () => { clearTimeout(timer); resolve(window.naver.maps); };
    const script = document.createElement('script');
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(NAVER_MAPS_CLIENT_ID)}&submodules=geocoder&callback=matjipMapReady`;
    script.onerror = () => { clearTimeout(timer); fail(); };
    document.head.append(script);
  });
  return sdk;
}
export class RestaurantMap {
  constructor(container, location, onSelect) {
    const n = window.naver.maps;
    this.map = new n.Map(container, { center: new n.LatLng(location.lat, location.lon), zoom: 15, minZoom: 7, maxZoom: 20, zoomControl: true, zoomControlOptions: { position: n.Position.RIGHT_BOTTOM }, scaleControl: true, mapDataControl: true, logoControl: true });
    this.markers = []; this.onSelect = onSelect;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(document.getElementById(container));
  }
  center(location, coveredHeight=0) { const n=window.naver.maps;this.map.setCenter(new n.LatLng(location.lat,location.lon));if(coveredHeight)this.map.panBy(new n.Point(0,Math.min(coveredHeight/2,innerHeight*.35))); }
  getCenter() { const p = this.map.getCenter(); return { lat: p.lat(), lon: p.lng() }; }
  resize() { const n = window.naver.maps; n.Event.trigger(this.map, 'resize'); }
  origin(location, label) {
    const n = window.naver.maps;
    this.originMarker?.setMap(null);
    this.originMarker = new n.Marker({ map: this.map, position: new n.LatLng(location.lat, location.lon), title: label, zIndex: 10000,
      icon: { content: '<div class="mh-user-pin" aria-label="탐색 중심"></div>', size: new n.Size(22, 22), anchor: new n.Point(11,11) } });
  }
  render(places, selectedId, escape) {
    const n = window.naver.maps;
    this.markers.forEach(marker => { n.Event.clearInstanceListeners(marker); marker.setMap(null); });
    this.markers = places.slice(0,100).map((p,i) => {
      const selected = p.id === selectedId;
      const content = `<button type="button" class="naver-place-marker kind-${escape(p.amenity)} ${i<5?'is-top':''} ${selected?'is-active':''}" aria-label="${escape(p.name)} 상세 보기"><span class="mh-pin"><span>${i<5?i+1:({restaurant:'🍲',cafe:'☕',fast_food:'🥪',food_court:'🍱'}[p.amenity]||'🍴')}</span></span>${i<5||selected?`<span class="marker-label">${escape(p.name)}</span>`:''}</button>`;
      const marker = new n.Marker({ map: this.map, position: new n.LatLng(p.lat,p.lon), title: p.name, zIndex: selected?3000:i<5?200:1, icon: { content, anchor: new n.Point(18,36) } });
      n.Event.addListener(marker, 'click', () => this.onSelect(p.id));
      return marker;
    });
  }
}
