import { NAVER_MAPS_CLIENT_ID } from '../config.js?v=20261027d';
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
  constructor(container, location, onSelect, coveredHeight) {
    const n = window.naver.maps;
    this.map = new n.Map(container, { center: new n.LatLng(location.lat, location.lon), zoom: 17, minZoom: 7, maxZoom: 20, zoomControl: true, zoomControlOptions: { position: n.Position.RIGHT_BOTTOM }, scaleControl: true, mapDataControl: true, logoControl: true, logoControlOptions: {position:n.Position.TOP_RIGHT}, mapDataControlOptions: {position:n.Position.TOP_RIGHT} });
    this.coveredHeight=coveredHeight;this.focusLocation=location;this.element=document.getElementById(container);this.markers = []; this.onSelect = onSelect;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.element.parentElement);
  }
  center(location, coveredHeight=0) { this.focusLocation=location;const n=window.naver.maps;this.map.setCenter(new n.LatLng(location.lat,location.lon));if(coveredHeight)this.map.panBy(new n.Point(0,Math.min(coveredHeight/2,innerHeight*.35))); }
  getCenter(coveredHeight=0) { const n=window.naver.maps;const p=coveredHeight?this.map.getProjection().fromOffsetToCoord(new n.Point(this.element.clientWidth/2,(this.element.clientHeight-coveredHeight)/2)):this.map.getCenter();return {lat:p.lat(),lon:p.lng()}; }
  resize() { const n=window.naver.maps;const parent=this.element.parentElement;this.map.setSize(new n.Size(parent.clientWidth,parent.clientHeight));this.center(this.focusLocation,this.coveredHeight?.()||0); }
  origin(location, label) {
    const n = window.naver.maps;
    this.originMarker?.setMap(null);
    this.originMarker = new n.Marker({ map: this.map, position: new n.LatLng(location.lat, location.lon), title: label, zIndex: 10000,
      icon: { content: '<div class="mh-user-pin" aria-label="탐색 중심"></div>', size: new n.Size(22, 22), anchor: new n.Point(11,11) } });
  }
  render(places, selectedId, escape) {
    const n = window.naver.maps;
    this.markers.forEach(marker => { n.Event.clearInstanceListeners(marker); marker.setMap(null); });
    const visible=places.slice(0,100);const selectedPlace=places.find(p=>p.id===selectedId);if(selectedPlace&&!visible.some(p=>p.id===selectedId))visible.push(selectedPlace);
    this.markers = visible.map((p,i) => {
      const selected = p.id === selectedId;
      const content = `<button type="button" class="naver-place-marker kind-${escape(p.amenity)} ${i<5?'is-top':''} ${selected?'is-active':''}" aria-label="${escape(p.name)} 상세 보기"><span class="mh-pin"><span>${i<5?i+1:({restaurant:'🍲',cafe:'☕',fast_food:'🥪',food_court:'🍱'}[p.amenity]||'🍴')}</span></span>${i<5||selected?`<span class="marker-label">${escape(p.name)}</span>`:''}</button>`;
      const marker = new n.Marker({ map: this.map, position: new n.LatLng(p.lat,p.lon), title: p.name, zIndex: selected?3000:i<5?500-i*10:1, icon: { content, anchor: new n.Point(18,36) } });
      n.Event.addListener(marker, 'click', () => this.onSelect(p.id));
      return marker;
    });
  }
}
