#!/usr/bin/env python3
"""Read-only WJP Ops CLI. No exchange, shell or secret-export operations."""
import argparse
import json
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.parse import urlparse

parser=argparse.ArgumentParser(description="Inspect WJP Yield through its controlled Owner gateway")
parser.add_argument("command",choices=["status","agents","tasks","journal","bots","strategies","backtests","health"])
parser.add_argument("--url",default="http://localhost:4312")
parser.add_argument("--token-file",help="Owner token file outside synchronized storage; never pass the token as an argument")
args=parser.parse_args()
parsed=urlparse(args.url)
if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {'','/'}:
    parser.error("Use a base URL without credentials/path/query")
if parsed.scheme!='https' and not (parsed.scheme=='http' and parsed.hostname in {'localhost','127.0.0.1'}):
    parser.error("Remote gateway must use HTTPS")
headers={}
if args.token_file:
    p=Path(args.token_file)
    if not p.is_absolute() or 'Mobile Documents' in str(p):parser.error("Token file must be an absolute local non-iCloud path")
    headers['Authorization']='Bearer '+p.read_text().strip()
path='/health' if args.command=='health' else '/lab' if args.command in {'bots','strategies','backtests'} else '/journal' if args.command=='journal' else '/snapshot'
try:
    with urlopen(Request(args.url.rstrip('/')+'/api/firm'+path,headers=headers),timeout=10) as response:data=json.load(response)
except Exception:
    parser.exit(1,"Gateway unavailable or unauthorized. Check host/service and Owner credentials.\n")
if args.command in {'agents','tasks','bots','strategies','backtests'}:data=data[args.command]
if args.command=='status':data={k:data[k] for k in ['config','metrics']}
print(json.dumps(data,ensure_ascii=False,indent=2,default=str))
