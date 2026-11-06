"""Archive only the hosted runtime; exclude local state, receipts and logs."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import sys

stage=Path(sys.argv[1]).resolve()
destination=Path(sys.argv[2]).resolve()
trees=['node_modules','packages/frontend/dist','packages/sdk/dist',
       'packages/contracts/artifacts/contracts','packages/contracts/scripts']
files=['package.json','package-lock.json','deployment-source.json',
       'packages/contracts/package.json','packages/contracts/hardhat.config.ts',
       'packages/sdk/package.json','infra/azure/fork/server.mjs',
       'infra/azure/fork/policy.mjs','infra/azure/fork/quote.mjs']
with ZipFile(destination,'w',ZIP_DEFLATED,compresslevel=6) as archive:
    # These are written by the demo/verifier after deployment. ZIP archives do
    # not preserve empty directories unless they are explicitly included.
    for directory in ['packages/contracts/evidence/','deployments/']:
        archive.writestr(directory,b'')
    for file in files:
        archive.write(stage/file,file)
    for tree in trees:
        for path in sorted((stage/tree).rglob('*')):
            if path.is_file() and '.bin' not in path.parts:
                archive.write(path,path.relative_to(stage))
print(f'Runtime archive: {destination.name} ({destination.stat().st_size//1024//1024} MiB)')
