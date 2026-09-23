# ABOUTME: End-to-end smoke test against the local Worker at localhost:8798.
# ABOUTME: Creates temporary local keys and cities; never targets production.
import json,urllib.request,urllib.error
base='http://localhost:8798'
key=''
def call(path,body=None,method=None):
    req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,method=method or ('POST' if body is not None else 'GET'),headers={'Content-Type':'application/json','Authorization':'Bearer '+key,'X-HS-Client':'hallucinating-splines-mcp'})
    with urllib.request.urlopen(req) as r:return json.load(r)
assert call('/v1/keys/status')['limit']==2000
key=call('/v1/keys',{},'POST')['key']
city=call('/v1/cities',{'seed':42})['id']; path='/v1/cities/'+city
print('created local test city',city)
# Every returned footprint must permit placement (using new cities avoids collisions).
for action in ['build_coal_power','build_airport','build_fire_station']:
    pos=call(path+'/map/buildable?action='+action)['valid_positions'][0]
    result=call(path+'/actions',{'action':action,**pos,'auto_bulldoze':True})
    assert result['success'],(action,pos,result)
    print('buildable placement',action,'passed')
pos=call(path+'/map/buildable?action=zone_residential')['valid_positions'][0]
r=call(path+'/batch',{'actions':[{'action':'zone_residential',**pos,'auto_bulldoze':True},{'action':'zone_residential',**pos}]})
assert (r['succeeded'],r['failed'],r['skipped'])==(1,1,0),r
log=call(path+'/actions')['actions'];batch=next(a for a in log if a['action_type']=='batch')
assert batch['result']=='partial',batch
assert batch['params']['results'][1]['reason'],batch
print('last-action failure classified and logged correctly')
# A separate empty city demonstrates a successful zone with explicit power-connection failure.
city2=call('/v1/cities',{'seed':42})['id'];p2='/v1/cities/'+city2
pos=call(p2+'/map/buildable?action=zone_residential')['valid_positions'][0]
r=call(p2+'/actions',{'action':'zone_residential',**pos,'auto_bulldoze':True,'auto_power':True,'auto_road':True})
assert r['success'] and any(a.get('failed') and a['reason']=='no_powered_tile_reachable' for a in r['auto_actions']),r
print('automatic power failure visible while primary zone succeeds')
print('LOCAL HTTP SMOKE PASSED')
