"""Stage a private package in Blob Storage, then let Kudu download it in Azure."""
import json,os,subprocess,sys,time,urllib.request,urllib.error,hashlib
from datetime import datetime,timedelta,timezone
from pathlib import Path
from urllib.parse import urlparse,urljoin

package=Path(sys.argv[1]).resolve()
host=urlparse(sys.argv[2]).hostname
if not host or not host.endswith('.azurewebsites.net') or '.scm.' in host:
    raise SystemExit('Expected the HTTPS App Service origin')
scm='https://'+host.replace('.azurewebsites.net','.scm.azurewebsites.net')
token=subprocess.run(['az','account','get-access-token','--query','accessToken','--output','tsv'],capture_output=True,text=True,check=True).stdout.strip()
headers={'Authorization':'Bearer '+token}
journal=package.parent/'fork-upload.json'
state={'origin':'https://'+host,'package':package.name,'startedAt':time.time(),'phase':'uploading'}
def save():
    journal.write_text(json.dumps(state,indent=2)+'\n');journal.chmod(0o600)
save()
group=os.environ.get('FORK_AZURE_RESOURCE_GROUP','firmdepth-debt-demo-rg')
location=os.environ.get('FORK_AZURE_LOCATION','centralindia')
storage=os.environ.get('FORK_AZURE_PACKAGE_STORAGE','firmdepthdebt3207de')
if group=='firmdepth-mumbai-rg':raise SystemExit('Package storage must be isolated from the production resource group')
def cli(args,env=None):
    result=subprocess.run(['az',*args],env=env,capture_output=True,text=True)
    if result.returncode:
        error_file=journal.parent/'fork-upload-error.log'
        error_file.write_text(result.stderr);error_file.chmod(0o600)
        raise RuntimeError('Azure package operation failed: '+args[0]+' '+args[1]+'; diagnostic saved privately in .azure-package/fork-upload-error.log')
    return result.stdout.strip()
cli(['storage','account','create','--name',storage,'--resource-group',group,'--location',location,'--sku','Standard_LRS','--kind','StorageV2','--https-only','true','--min-tls-version','TLS1_2','--allow-blob-public-access','false','--output','none'])
storage_key=cli(['storage','account','keys','list','--account-name',storage,'--resource-group',group,'--query','[0].value','--output','tsv'])
storage_env={**os.environ,'AZURE_STORAGE_KEY':storage_key}
cli(['storage','container','create','--account-name',storage,'--name','packages','--auth-mode','key','--output','none'],storage_env)
digest=hashlib.sha256(package.read_bytes()).hexdigest()
blob=f'fork-{digest[:20]}.zip'
print(f'Staging {package.stat().st_size//1024//1024} MiB in private Azure Blob Storage.',flush=True)
cli(['storage','blob','upload','--account-name',storage,'--container-name','packages','--name',blob,'--file',str(package),'--auth-mode','key','--overwrite','true','--max-connections','4','--output','none'],storage_env)
expiry=(datetime.now(timezone.utc)+timedelta(hours=2)).strftime('%Y-%m-%dT%H:%MZ')
sas=cli(['storage','blob','generate-sas','--account-name',storage,'--container-name','packages','--name',blob,'--permissions','r','--expiry',expiry,'--https-only','--output','tsv'],storage_env)
package_uri=f'https://{storage}.blob.core.windows.net/packages/{blob}?{sas}'
state.update(phase='staged',storageAccount=storage,blob=blob,sha256=digest);save()
print('Private package staged; requesting an Azure-to-Azure deployment download.',flush=True)
request=urllib.request.Request(scm+'/api/zipdeploy?isAsync=true',data=json.dumps({'packageUri':package_uri}).encode(),headers={**headers,'Content-Type':'application/json'},method='PUT')
try:
    with urllib.request.urlopen(request,timeout=900) as response:
        location=response.headers.get('Location')
        if response.status not in (200,202):raise RuntimeError('Upload was not accepted')
except Exception:
    state['phase']='upload-unconfirmed';save()
    raise SystemExit('Upload was not confirmed. Inspect the app deployment status before retrying; credentials have not been printed.')
location=urljoin(scm,location or '/api/deployments/latest')
if urlparse(location).hostname!=urlparse(scm).hostname:raise SystemExit('Unexpected deployment status host')
location=location.replace('http://','https://',1)
state.update(phase='accepted',statusUrl=location);save();last=None
for attempt in range(240):
    try:
        with urllib.request.urlopen(urllib.request.Request(location,headers=headers),timeout=30) as response:status=json.load(response)
    except (urllib.error.HTTPError,TimeoutError):time.sleep(5);continue
    current=status.get('status')
    if current!=last:print('Kudu deployment status:',current,flush=True);last=current
    if current==4:
        state.update(phase='deployed',deploymentId=status.get('id'),completedAt=time.time());save()
        print('Azure package deployed. Separately require authenticated fork health and repayment proof.',flush=True)
        break
    if current==3:
        state.update(phase='failed',deploymentId=status.get('id'));save()
        raise SystemExit('Kudu deployment failed. Inspect the private deployment logs.')
    time.sleep(5)
else:raise SystemExit('Deployment polling timed out. Inspect the recorded status URL before retrying.')
