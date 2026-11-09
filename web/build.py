# web/ 조각을 합쳐 docs/index.html(완전한 HTML)과 artifact용 본문을 만듭니다.
import sys
from pathlib import Path
W=Path(__file__).parent
body=(W/'head.html').read_text()+"\n<script>\n"+(W/'engine.js').read_text()+"\n</script>\n<script>\n"+(W/'ui.js').read_text()+"\n</script>\n"
out=Path(sys.argv[1])
(out/'index.html').write_text('<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<!-- 전국 학사일정 분석 대시보드. 데이터: data/ (collector가 생성). 수정은 web/ 원본에서 하고 python web/build.py docs 로 다시 만드세요. -->\n<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font-size:14px}img{max-width:100%}[hidden]{display:none!important}</style>\n</head><body>\n'+body+'</body></html>\n',encoding='utf-8')
(W/'artifact_body.html').write_text(body,encoding='utf-8')
print('built',len(body))
