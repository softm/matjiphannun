import importlib.util, pathlib, unittest, json
spec=importlib.util.spec_from_file_location('enrich',pathlib.Path(__file__).parents[1]/'scripts/enrich_web.py')
e=importlib.util.module_from_spec(spec);spec.loader.exec_module(e)
AT='2026-10-28T23:00:00+09:00'
ENTRY={'cotid':'0006931a-e473-4516-8824-bb53813d6ad5','modified':'2026-10-01'}
TARGET={'id':'tour:1','name':'테스트식당','address':'서울특별시 중구 길 1 1층','lat':37.5,'lon':127}
def source(**kwargs):
 return {'header':{'process':'success'},'body':{'article':[{'cid':'1','contentType':39,'contentStatus':2,'title':TARGET['name'],'addr1':TARGET['address'],'mapY':37.5,'mapX':127,'parking':'불가','openTime':'11:00~22:00<br>브레이크타임 15:00~17:00','firstMenu':'칼국수','tel':'관광정보 관리 담당자','telNo':'02-111-2222',**kwargs}],'image':[{'imgPath':'uuid','imgAlt':'미확인 사진'}],'userimage':[{'author':'private-user','imgPath':'private-image'}]}}
class Enrichment(unittest.TestCase):
 def test_identity_checks_reject_different_floor_or_reassigned_content_id(self):
  for changes in [{'addr1':'서울특별시 중구 길 1 2층'},{'title':'다른집'},{'mapY':38.0}]:
   record,status=e.normalize_kto(source(**changes),ENTRY,{'1':TARGET},AT);self.assertIsNone(record);self.assertEqual(status,'identity-mismatch')
 def test_source_caveats_and_provenance_are_preserved(self):
  record,status=e.normalize_kto(source(),ENTRY,{'1':TARGET},AT)
  self.assertEqual(status,'matched');self.assertTrue(any(p['kind']=='caution' and p['text']=='불가' for p in record['points']))
  self.assertTrue(all(p['evidence']['sourceUrl']==record['sourceUrl'] for p in record['points']))
  text=json.dumps(record,ensure_ascii=False);self.assertNotIn('private-user',text);self.assertNotIn('관광정보 관리 담당자',text)
 def test_missing_photo_rights_never_authorize_image_publication(self):
  record,_=e.normalize_kto(source(),ENTRY,{'1':TARGET},AT)
  self.assertEqual(record['images'],[]);self.assertEqual(record['photoGallery']['count'],1)
 def test_owner_jsonld_requires_name_street_and_building_number(self):
  node={'@type':'Restaurant','name':TARGET['name'],'address':{'streetAddress':'길 1 1층'},'openingHours':'11:00-21:00','aggregateRating':{'ratingValue':5}}
  page='<script type="application/ld+json">'+json.dumps(node)+'</script>'
  self.assertEqual(len(e.owner_facts(page,'https://example.com',TARGET,AT)),1)
  node['address']['streetAddress']='길 1 2층';page='<script type="application/ld+json">'+json.dumps(node)+'</script>'
  self.assertEqual(e.owner_facts(page,'https://example.com',TARGET,AT),[])
 def test_conflicting_sources_stay_separate(self):
  facts=[e.fact('parking','가능','https://example.com',AT),e.fact('parking','불가','https://other.com',AT)]
  points,conflicts=e.make_points(facts);self.assertEqual(len(conflicts),1);self.assertTrue(all(p['kind']=='conflict' for p in points))
 def test_unsafe_schemes_and_private_addresses_are_rejected(self):
  for url in ['file:///etc/passwd','http://127.0.0.1','http://169.254.169.254','https://user:pass@example.com','http://localhost','https://example.com:8080']:
   self.assertFalse(e.safe_url(url),url)
 def test_building_number_hyphens_and_prefixes_do_not_merge_different_restaurants(self):
  different={**TARGET,'address':'서울특별시 중구 길 1-1'}
  record,status=e.normalize_kto(source(addr1='서울특별시 중구 길 11'),ENTRY,{'1':different},AT)
  self.assertIsNone(record);self.assertEqual(status,'identity-mismatch')
  page='<script type="application/ld+json">'+json.dumps({'@type':'Restaurant','name':TARGET['name'],'address':{'streetAddress':'길 1'},'openingHours':'11:00-21:00'})+'</script>'
  self.assertEqual(e.owner_facts(page,'https://example.com',{**TARGET,'address':'서울 중구 길 11'},AT),[])
 def test_sitemap_does_not_accept_arbitrary_hosts(self):
  xml='<urlset><url><loc>https://evil.example/detail/ms_detail.do?cotid='+ENTRY['cotid']+'</loc></url></urlset>'
  with self.assertRaises(ValueError):e.sitemap_entries(xml)
 def test_inactive_listing_never_supplies_live_visit_information(self):
  record,status=e.normalize_kto(source(contentStatus=0),ENTRY,{'1':TARGET},AT);self.assertIsNone(record);self.assertEqual(status,'unavailable')
if __name__=='__main__':unittest.main()
