import { markerLayout } from './marker-layout.js?v=20261029c';
import { NAVER_MAPS_CLIENT_ID } from '../config.js?v=20261029c';
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
    this.coveredHeight=coveredHeight;this.focusLocation=location;this.element=document.getElementById(container);this.markers = []; this.markerCache=new Map(); this.onSelect = onSelect;
    n.Event.addListener(this.map, 'idle', () => { if(this.lastRender)this.render(...this.lastRender);this.onViewport?.(this.getViewport()); });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.element.parentElement);
  }
  getViewport(){const b=this.map.getBounds(),sw=b.getSW(),ne=b.getNE();return {west:sw.lng(),south:sw.lat(),east:ne.lng(),north:ne.lat()};}
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
    this.lastRender=[places,selectedId,escape];
    const n = window.naver.maps;

    const bounds=this.map.getBounds(),sw=bounds.getSW(),ne=bounds.getNE();
    const ranks=new Map(places.slice(0,5).map((p,i)=>[p.id,i]));
    const visible=markerLayout(places,{south:sw.lat(),north:ne.lat(),west:sw.lng(),east:ne.lng()},selectedId);
    const wanted=new Set(visible.map(p=>p.id));
    for(const [id,item] of this.markerCache)if(!wanted.has(id)){n.Event.clearInstanceListeners(item.marker);item.marker.setMap(null);this.markerCache.delete(id);}
    this.markers = visible.map(p => {
      const i=ranks.get(p.id)??999;
      const selected = p.id === selectedId;
      const content = p.count ? `<button type="button" class="restaurant-cluster" aria-label="음식점 ${p.count}곳 확대 보기">${p.count.toLocaleString('ko-KR')}</button>` : `<button type="button" class="naver-place-marker kind-${escape(p.amenity)} ${i<5?'is-top':''} ${selected?'is-active':''}" aria-label="${escape(p.name)} 상세 보기"><span class="mh-pin"><span>${i<5?i+1:({restaurant:'🍲',cafe:'☕',fast_food:'🥪',food_court:'🍱'}[p.amenity]||'🍴')}</span></span>${i<5||selected?`<span class="marker-label">${escape(p.name)}</span>`:''}</button>`;
      const existing=this.markerCache.get(p.id);
      if(existing&&existing.content===content&&existing.lat===p.lat&&existing.lon===p.lon)return existing.marker;
      if(existing){n.Event.clearInstanceListeners(existing.marker);existing.marker.setMap(null);}
      const marker = new n.Marker({ map: this.map, position: new n.LatLng(p.lat,p.lon), title: p.name, zIndex: selected?3000:i<5?500-i*10:1, icon: { content, anchor: new n.Point(18,36) } });
      n.Event.addListener(marker, 'click', () => {if(p.count){this.map.setCenter(new n.LatLng(p.lat,p.lon));this.map.setZoom(Math.min(20,this.map.getZoom()+2));}else this.onSelect(p.id);});
      this.markerCache.set(p.id,{marker,content,lat:p.lat,lon:p.lon});
      return marker;
    });
  }
}
