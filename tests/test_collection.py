import importlib.util,json,pathlib,tempfile,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('collector',pathlib.Path(__file__).parents[1]/'scripts/collect_data.py');c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
AT='2026-10-27T03:00:00+09:00'
def food(**kwargs):
 return {'LCNS_NO':'lic','BSSH_NM':'맛집','ADDR':'서울특별시 중구 세종대로 1','ASGN_FROM':'20260101','ASGN_TO':'20271231','ASGN_CANCEL_YMD':'','CLSBIZ_DT':'','CLSBIZ_DVS_CD_NM':'정상','HG_ASGN_LV':'매우우수','HG_ASGN_NO':'grade',**kwargs}
def sbiz(**kwargs):
 return {'bizesId':'1','bizesNm':'맛집','brchNm':'','rdnmAdr':'서울특별시 중구 세종대로 1','lat':37.5,'lon':127,'indsLclsCd':'I2','indsSclsNm':'한식','stdrDt':'2026-06',**kwargs}
class DataRules(unittest.TestCase):
 def test_hygiene_validity_excludes_future_expired_cancelled_and_closed(self):
  self.assertTrue(c.valid_hygiene(food(),'20261027'))
  for row in [food(ASGN_FROM='20270101'),food(ASGN_TO='20260101'),food(ASGN_CANCEL_YMD='20261001'),food(CLSBIZ_DT='20261001'),food(CLSBIZ_DVS_CD_NM='폐업'),food(ASGN_TO='')]:self.assertFalse(c.valid_hygiene(row,'20261027'))
 def test_name_only_or_same_building_is_never_a_hygiene_match(self):
  places,_=c.combine([sbiz()],[],[food(BSSH_NM='다른집')],AT);self.assertIsNone(places[0]['hygiene'])
  places,_=c.combine([sbiz()],[],[food(ADDR='서울특별시 중구 세종대로 1 2층')],AT);self.assertIsNone(places[0]['hygiene'])
  places,_=c.combine([sbiz()],[],[food(),food(LCNS_NO='other')],AT);self.assertIsNone(places[0]['hygiene'])
 def test_exact_match_has_valid_dates_but_never_owner_or_business_registration(self):
  places,_=c.combine([sbiz()],[],[food(PRSDNT_NM='private',WRKR_REG_NO='private-number')],AT)
  p=places[0];self.assertEqual(p['hygiene']['grade'],'매우우수');self.assertNotIn('private',json.dumps(p));self.assertEqual(p['sourceDate'],'2026-06')
 def test_unknown_rights_and_other_hosts_do_not_become_images(self):
  row=['5','카페','주소',37.5,127,'https://tong.visitkorea.or.kr/test.jpg','Type3','20261026','','11','110','FD050100']
  self.assertEqual(c.normalize_tour_tuple(row,AT)['images'][0]['license'],'Type3')
  row[6]='';self.assertEqual(c.normalize_tour_tuple(row,AT)['images'],[])
  row[6]='Type1';row[5]='https://example.com/photo.jpg';self.assertEqual(c.normalize_tour_tuple(row,AT)['images'],[])
 def test_invalid_coordinates_and_non_food_categories_are_not_published(self):
  self.assertIsNone(c.normalize_sbiz(sbiz(lat=0),AT));self.assertIsNone(c.normalize_sbiz(sbiz(indsLclsCd='G2'),AT))
 def test_logical_api_errors_are_not_zero_results(self):
  with self.assertRaises(c.CollectionError):c.unpack({'response':{'header':{'resultCode':'30'},'body':{'totalCount':0}}},'tour')
 def test_failed_publish_preserves_last_manifest(self):
  with tempfile.TemporaryDirectory() as td:
   p=pathlib.Path(td);(p/'manifest.json').write_text('last-good')
   with self.assertRaises(c.CollectionError):c.publish([],{},p,AT)
   self.assertEqual((p/'manifest.json').read_text(),'last-good')
 def test_shards_and_manifest_consistent(self):
  with tempfile.TemporaryDirectory() as td:
   p=pathlib.Path(td);places,_=c.combine([sbiz()],[],[],AT);c.publish(places,{'coverage':{'sbiz':'partial'}},p,AT)
   packed_manifest=json.loads((p/'manifest.json').read_text());m=json.loads(c.gzip.decompress(c.base64.b64decode(packed_manifest['data'])));self.assertEqual(m['count'],sum(s['count'] for s in m['shards']))
   shard=m['shards'][0];data=(p/shard['path']).read_bytes();self.assertEqual(c.hashlib.sha256(data).hexdigest(),shard['sha256'])
   packed=json.loads(data);decoded=json.loads(c.gzip.decompress(c.base64.b64decode(packed['data'])));self.assertEqual(decoded['places'][0]['name'],'맛집')
if __name__=='__main__':unittest.main()

class OfficialZip(unittest.TestCase):
 def test_national_csv_import_filters_food_and_keeps_source_date(self):
  with tempfile.TemporaryDirectory() as td:
   path=pathlib.Path(td)/'official.zip'
   header=['상가업소번호','상호명','지점명','도로명주소','지번주소','위도','경도','상권업종대분류코드','상권업종소분류명']
   with c.zipfile.ZipFile(path,'w') as archive:
    for i in range(17):
     stream=c.io.StringIO();writer=c.csv.writer(stream);writer.writerow(header);writer.writerow([str(i),'식당','','주소','지번',37,127,'I2','한식']);writer.writerow(['other'+str(i),'다른업종','','주소','지번',37,127,'G2','소매']);archive.writestr('region-'+str(i)+'.csv',stream.getvalue().encode('utf-8-sig'))
   rows,info=c.load_sbiz_zip(path,'2026-06-30');self.assertEqual(len(rows),17);self.assertEqual(info['allIndustriesRows'],34);self.assertTrue(all(r['stdrDt']=='2026-06-30' for r in rows))

class AmbiguousMatches(unittest.TestCase):
 def test_multiple_same_name_address_tour_records_stay_separate(self):
  rows=[[str(i),'맛집','서울특별시 중구 세종대로 1',37.5,127,'','', '20261026','','11','110','FD010100'] for i in [1,2]]
  places,stats=c.combine([sbiz()],rows,[],AT);self.assertEqual(stats['tourMatches'],0);self.assertEqual(len(places),3)
 def test_duplicate_primary_stores_do_not_receive_one_shared_hygiene_badge(self):
  places,_=c.combine([sbiz(),sbiz(bizesId='2')],[],[food()],AT);self.assertTrue(all(p['hygiene'] is None for p in places))
