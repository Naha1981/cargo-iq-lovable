"""Original illustrative Gaussian harbour; no external scan or real shipment data."""
from pathlib import Path
import math,struct,json,hashlib
out=Path('public/splat-sample'); rows=[]
def point(x,y,z,c,s=.075): rows.append(struct.pack('<6f8B',x,y,z,s,s,s,*c,235,255,128,128,128))
def box(x,y,z,w,h,d,c):
 n=max(2,round(w/.12));m=max(2,round(h/.12));k=max(2,round(d/.12))
 for i in range(n+1):
  for j in range(k+1):point(x+w*i/n,y+h,z+d*j/k,c)
 for i in range(n+1):
  for j in range(m+1):
   point(x+w*i/n,y+h*j/m,z,c);point(x+w*i/n,y+h*j/m,z+d,c)
 for i in range(k+1):
  for j in range(m+1):
   point(x,y+h*j/m,z+d*i/k,c);point(x+w,y+h*j/m,z+d*i/k,c)
box(-7,-.6,-5,14,.3,10,(29,79,102))
box(1,-.25,-5,6,.3,10,(137,143,139))
box(-3,-.1,-2,2.6,.55,6,(45,57,67))
colors=[(188,91,62),(51,118,145),(199,157,72),(84,131,110)]
for i in range(3):
 for j in range(2):box(-2.85+i*.85,.45,-1.8+j*1.55,.78,.55,1.45,colors[(i+j)%4])
box(-2.8,.5,2.1,2.2,1.0,1.2,(213,221,216))
for x in [2,4.3]:
 box(x,0,-3,.15,4,.15,(220,160,61));box(x,3.85,-3,1.9,.15,.15,(220,160,61));box(x+1.7,2.5,-3,.08,1.4,.08,(220,160,61))
b=b''.join(rows);(out/'illustrative-harbour.splat').write_bytes(b)
m={'name':'Illustrative harbour study','format':'splat','gaussians':len(rows),'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'source':'Original CargoIQ procedural geometry','licence':'CC0-1.0','acquiredAt':None,'classification':'ILLUSTRATIVE_SYNTHETIC','limitations':'Not a scan of Durban, a vessel, a berth or a shipment. No georeferencing, capture time, measurements or historical evidence. Demonstrates Gaussian rendering and viewpoint capture only.'}
(out/'manifest.json').write_text(json.dumps(m,indent=2));print(m)
